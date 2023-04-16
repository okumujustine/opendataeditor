import * as React from 'react'
import * as zustand from 'zustand'
import { createStore } from 'zustand/vanilla'
import { assert } from 'ts-essentials'
import { Client } from '../../../client'
import { IFile, IFileItem, ITreeItem, IFileEvent } from '../../../interfaces'
import { ApplicationProps } from './Application'
import * as helpers from '../../../helpers'

type IDialog =
  | 'folder/copy'
  | 'folder/move'
  | 'name/create'
  | 'name/rename'
  | 'link/create'
  | 'create/dialog'

export interface State {
  client: Client
  path?: string
  file?: IFile
  fileItems: IFileItem[]
  fileEvent?: IFileEvent
  dialog?: IDialog
  loading?: boolean
  updateState: (patch: Partial<State>) => void
  onCreate: (path: string) => Promise<void>
  onDelete: (path: string) => Promise<void>
  onUpdate: (path: string) => Promise<void>
  select: (path?: string) => Promise<void>

  // File

  copyFile: (folder?: string) => Promise<void>
  deleteFile: () => Promise<void>
  listFiles: () => Promise<void>
  moveFile: (folder?: string) => Promise<void>
  renameFile: (name: string) => Promise<void>
  uploadFiles: (files: FileList) => Promise<void>
  createFile: (url: string) => Promise<void>
  countFiles: () => Promise<number>

  // Folder

  createFolder: (name: string) => Promise<void>
  uploadFolder: (files: FileList) => Promise<void>

  // Others

  createPackage: () => Promise<void>
  createChart: () => Promise<void>
  createView: () => Promise<void>
}

export function makeStore(props: ApplicationProps) {
  return createStore<State>((set, get) => ({
    client: props.client,
    fileItems: [],
    loading: true,
    updateState: (patch) => {
      set(patch)
    },
    onCreate: async (path) => {
      const { listFiles, select } = get()
      await listFiles()
      set({ fileEvent: { type: 'create', paths: [path] } })
      select(path)
    },
    onDelete: async (path) => {
      const { listFiles, select } = get()
      await listFiles()
      set({ fileEvent: { type: 'delete', paths: [path] } })
      select(undefined)
    },
    onUpdate: async (path) => {
      const { listFiles } = get()
      await listFiles()
      set({ fileEvent: { type: 'update', paths: [path] } })
    },
    select: async (path) => {
      const { client } = get()
      set({ path })
      if (!selectors.isFolder(get())) {
        const { file } = path ? await client.fileIndex({ path }) : { file: undefined }
        set({ file })
      }
    },

    // File

    countFiles: async () => {
      const { client } = get()
      const { count } = await client.fileCount()
      return count
    },
    listFiles: async () => {
      const { client } = get()
      const { items } = await client.fileList()
      set({ fileItems: items })
      set({ loading: false })
    },
    createFile: async (path) => {
      const { client, onCreate } = get()
      const folder = selectors.folderPath(get())
      const result = await client.fileCreate({ path, folder })
      // TODO: review
      if (!result.path) return
      onCreate(result.path)
    },
    copyFile: async (folder) => {
      const { client, path, onCreate } = get()
      if (!path) return
      const result = await client.fileCopy({ path, folder })
      onCreate(result.path)
    },
    deleteFile: async () => {
      const { client, path, onDelete } = get()
      if (!path) return
      const result = await client.fileDelete({ path })
      onDelete(result.path)
    },
    moveFile: async (folder) => {
      const { client, path, onCreate } = get()
      if (!path) return
      const result = await client.fileMove({ path, folder })
      onCreate(result.path)
    },
    renameFile: async (name) => {
      const { client, path, onCreate } = get()
      if (!path) return
      const result = await client.fileRename({ path, name })
      onCreate(result.path)
    },
    // TODO: upload in parallel?
    uploadFiles: async (files) => {
      const paths: string[] = []
      const { client, listFiles, select } = get()
      for (const file of files) {
        const folder = selectors.folderPath(get())
        const result = await client.fileUpload({ file, folder })
        paths.push(result.path)
      }
      if (!paths.length) return
      await listFiles()
      if (paths.length === 1) select(paths[0])
      set({ fileEvent: { type: 'create', paths } })
    },

    // Folder

    createFolder: async (name) => {
      const { client, onCreate } = get()
      const folder = selectors.folderPath(get())
      const { path } = await client.folderCreate({ name, folder })
      onCreate(path)
    },
    uploadFolder: async (files) => {
      const { path, client, onCreate } = get()
      let filesList: { [key: string]: any }[] = []
      let basePath
      const fileParts = files[0].webkitRelativePath.split('/')
      if (fileParts.length > 1) {
        basePath = await client.folderCreate({ name: fileParts[0], folder: path })
      }
      for (const file of files) {
        let folders = helpers.getFolderList(file)
        // remove duplicate
        folders = folders.filter(
          (item) =>
            !filesList.find(
              (file) => file.name === item.name && file.folder === item.folder
            )
        )
        filesList = filesList.concat(folders)
      }
      for (const file of filesList) {
        // handle duplicate folder upload
        const folderParts = file.folder.split('/')
        folderParts[0] = basePath?.path
        const folder = folderParts.join('/')

        if (file.type === 'folder') {
          await client.folderCreate({ name: file.name, folder: folder })
          continue
        }
        await client.fileUpload({ file: file.file, folder: folder })
      }
      // TODO: review
      if (path) onCreate(path)
    },

    // Others

    createPackage: async () => {
      const { client, onCreate } = get()
      const { path } = await client.packageCreate()
      onCreate(path)
    },
    createChart: async () => {
      const { client, onCreate } = get()
      const { path } = await client.chartCreate()
      onCreate(path)
    },
    createView: async () => {
      const { client, onCreate } = get()
      const { path } = await client.viewCreate()
      onCreate(path)
    },
  }))
}

export const selectors = {
  fileItem: (state: State) => {
    return state.fileItems.find((item) => item.path === state.path)
  },
  filePaths: (state: State) => {
    return state.fileItems
      .filter((item) => item.type === 'folder')
      .map((item) => item.path)
  },
  isFolder: (state: State) => {
    return !!state.fileItems.find(
      (item) => item.path === state.path && item.type === 'folder'
    )
  },
  folderPath: (state: State) => {
    if (!state.path) return undefined
    const isFolder = selectors.isFolder(state)
    if (isFolder) return state.path
    return helpers.getFolderPath(state.path)
  },
  fileTree: (state: State) => {
    return helpers.createFileTree(state.fileItems)
  },
  targetTree: (state: State) => {
    const fileTree = helpers.createFileTree(state.fileItems, ['folder'])
    const targetTree: ITreeItem[] = [
      { name: 'Project', path: '/', type: 'folder', children: fileTree },
    ]
    return targetTree
  },
}

export function useStore<R>(selector: (state: State) => R): R {
  const store = React.useContext(StoreContext)
  assert(store, 'store provider is required')
  return zustand.useStore(store, selector)
}

const StoreContext = React.createContext<zustand.StoreApi<State> | null>(null)
export const StoreProvider = StoreContext.Provider
