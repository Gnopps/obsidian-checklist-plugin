import * as os from 'os'

import type { App, LinkCache, MetadataCache, TagCache, TFile, Vault } from "obsidian"
import type {
  TodoItem,
  TodoGroup,
  GroupByType,
  SortDirection,
  TagMeta,
  TodoDisplayChunk,
  LinkMeta,
  DisplayChunkType,
  TokenChunk,
  FileInfo,
} from "src/_types"

/** public */

export const parseTodos = async (
  files: TFile[],
  todoTag: string,
  cache: MetadataCache,
  vault: Vault,
  sort: SortDirection,
  ignoreFiles: string
): Promise<TodoItem[]> => {
  const unignoredFiles = ignoreFiles ? files.filter((file) => !file.path.split("/").includes(ignoreFiles)) : files
  const filesToParse = todoTag
    ? unignoredFiles.filter(
        (file) => cache.getFileCache(file)?.tags?.filter((e) => getTagMeta(e.tag).main === todoTag)?.length
      )
    : unignoredFiles

  const fileInfo = await Promise.all(
    filesToParse.map<Promise<FileInfo>>(async (file) => {
      const fileCache = cache.getFileCache(file)
      const tagsOnPage = todoTag ? fileCache?.tags?.filter((e) => getTagMeta(e.tag).main === todoTag) ?? [] : undefined
      const content = await vault.cachedRead(file)
      return { content, cache: fileCache, validTags: tagsOnPage, file }
    })
  )

  const nonEmptyFiles = fileInfo.filter((f) => f.content)
  const allTodos = nonEmptyFiles.flatMap(getTodosFromFile)

  const finalTodos = allTodos.filter(
    (todo, i, a) => a.findIndex((_todo) => todo.line === _todo.line && todo.filePath === _todo.filePath) === i
  )

  finalTodos.sort((a, b) =>
    sort === "new->old" ? b.fileCreatedTs - a.fileCreatedTs : a.fileCreatedTs - b.fileCreatedTs
  )
  return finalTodos
}

export const groupTodos = (items: TodoItem[], groupBy: GroupByType): TodoGroup[] => {
  const groups: TodoGroup[] = []
  for (const item of items) {
    const itemKey =
      groupBy === "page" ? item.filePath : `#${[item.mainTag, item.subTag].filter((e) => e != null).join("/")}`
    let group = groups.find((g) => g.groupId === itemKey)
    if (!group) {
      group = {
        groupId: itemKey,
        groupName: groupBy === "page" ? item.fileLabel : item.subTag,
        type: groupBy,
        todos: [],
      }
      groups.push(group)
    }

    group.todos.push(item)
  }
  return groups.filter((g) => g.todos.length > 0)
}

export const toggleTodoItem = (item: TodoItem, app: App) => {
  const file = app.vault.getFiles().find((f) => f.path === item.filePath)
  const newData = setTodoStatusAtLineTo(file, item.line, !item.checked)
  app.vault.modify(file, newData)
}

export const navToFile = async (path: string, ev: MouseEvent) => {
  path = ensureMdExtension(path)
  const app: App = (window as any).app
  const file = getFileFromPath(path, app)
  if (!file) return
  const leaf = isMetaPressed(ev) ? app.workspace.splitActiveLeaf() : app.workspace.getUnpinnedLeaf()
  await leaf.openFile(file)
}

export const hoverFile = (event: MouseEvent, app: App, filePath: string) => {
  const targetElement = event.currentTarget
  const timeoutHandle = setTimeout(() => {
    app.workspace.trigger("link-hover", {}, targetElement, filePath, filePath)
  }, 800)
  targetElement.addEventListener("mouseleave", () => {
    clearTimeout(timeoutHandle)
  })
}

/** private */

const ensureMdExtension = (path: string) => {
  if (!/\.md$/.test(path)) return `${path}.md`
  return path
}

const getFileFromPath = (path: string, app: App) => app.vault.getFiles().find((f) => f.path.endsWith(path))

const isMetaPressed = (e: MouseEvent): boolean => {
  return isMacOS() ? e.metaKey : e.ctrlKey
}

const getTodosFromFile = (file: FileInfo) => {
  if (file.validTags) return file.validTags.flatMap((tag) => findAllTodosFromTag(file, tag))
  else return findAllTodosInFile(file)
}

const findAllTodosInFile = (file: FileInfo): TodoItem[] => {
  const fileLines = getAllLinesFromFile(file.content)
  const todos: TodoItem[] = []
  // for ()
  return []
}

const findAllTodosFromTag = (file: FileInfo, tag: TagCache) => {
  const links = file.cache.links ?? []
  const fileLines = getAllLinesFromFile(file.content)
  const tagMeta = getTagMeta(tag.tag)
  const tagLine = fileLines[tag.position.start.line]
  const originalLineIsTodo = lineIsValidTodo(tagLine, tagMeta.main)

  // step 1

  const todos: TodoItem[] = []
  let todoStack: TodoItem[] = []
  for (let i = tag.position.start.line; i < fileLines.length; i++) {
    const newItem = getTodoFromLine(fileLines[i], file.file, tagMeta, links, i)

    // const parentItem = todoStack.pop()
    // if (parentItem && parentItem.spacesIndented < newItem.spacesIndented) {
    //   parentItem.children.push(newItem)
    //   todoStack.push(parentItem)
    // } else {
    //   todos.push(newItem)
    // }
    // todoStack.push(newItem)
  }

  return todos
}

const getTodoFromLine = (
  line: string,
  file: TFile,
  tagMeta: TagMeta,
  links: LinkCache[],
  lineNum: number
): TodoItem | void => {
  if (line.length === 0) return
  if (!lineIsValidTodo(line, tagMeta.main)) return
  const newItem = formTodo(line, file, tagMeta, links, lineNum)
  return newItem
}

const formTodo = (line: string, file: TFile, tagMeta: TagMeta, links: LinkCache[], lineNum: number): TodoItem => {
  const relevantLinks = links
    .filter((link) => link.position.start.line === lineNum)
    .map((link) => ({ filePath: link.link, linkName: link.displayText }))
  const linkMap = mapLinkMeta(relevantLinks)
  const rawText = extractTextFromTodoLine(line)
  const spacesIndented = getIndentationSpacesFromTodoLine(line)
  const tagStripped = removeTagFromText(rawText, tagMeta.main)
  const rawChunks = parseTextContent(tagStripped)
  const displayChunks = decorateChunks(rawChunks, linkMap)
  return {
    mainTag: tagMeta.main,
    checked: todoLineIsChecked(line),
    display: displayChunks,
    filePath: file.path,
    fileName: file.name,
    fileLabel: getFileLabelFromName(file.name),
    fileCreatedTs: file.stat.ctime,
    line: lineNum,
    subTag: tagMeta?.sub,
    spacesIndented,
    children: [],
  }
}

const decorateChunks = (chunks: TokenChunk[], linkMap: Map<string, LinkMeta>): TodoDisplayChunk[] => {
  return chunks.map((chunk) => {
    if (chunk.type === "text")
      return {
        value: chunk.rawText,
        type: "text",
      }

    const children = decorateChunks(chunk.children, linkMap)

    if (chunk.type === "link")
      return {
        type: "link",
        children,
        filePath: linkMap.get(chunk.rawText)?.filePath,
        label: linkMap.get(chunk.rawText)?.linkName,
      }

    return { type: chunk.type, children }
  })
}

const parseTextContent = (formula: string): TokenChunk[] => {
  let tokens: TokenChunk[] = parseTokensFromText(
    [{ rawText: formula, type: "text" }],
    "bold",
    /\*\*[^\*]+\*\*/,
    /\*\*([^\*]+)\*\*/g
  )
  tokens = parseTokensFromText(tokens, "italic", /\*[^\*]+\*/, /\*([^\*]+)\*/g)
  tokens = parseTokensFromText(tokens, "link", /\[\[[^\]]+\]\]/, /\[\[([^\]]+)\]\]/g)

  return tokens
}

const parseTokensFromText = <T extends DisplayChunkType>(
  chunks: TokenChunk[],
  type: T,
  splitRegex: RegExp,
  tokenRegex: RegExp
): TokenChunk[] => {
  return chunks.flatMap((chunk) => {
    if (chunk.type === "text") {
      const pieces = chunk.rawText.split(splitRegex)
      const tokens = getAllMatches(tokenRegex, chunk.rawText, 1)
      return pieces.flatMap((piece, i) => {
        const token = tokens[i]
        const finalPieces = []
        if (piece) finalPieces.push({ type: "text", rawText: piece })
        if (token)
          finalPieces.push({
            type,
            rawText: token,
            children: [{ type: "text", rawText: token }],
          })
        return finalPieces
      })
    } else {
      return [
        {
          type: chunk.type,
          rawText: chunk.rawText,
          children: parseTokensFromText(chunk.children, type, splitRegex, tokenRegex),
        },
      ]
    }
  })
}

const getAllMatches = (r: RegExp, string: string, captureIndex = 0) => {
  if (!r.global) throw new Error("getAllMatches(): cannot get matches for non-global regex.")
  const matches: string[] = []
  r.lastIndex = 0 // reset regexp to first match
  let match: RegExpExecArray
  while ((match = r.exec(string))) matches.push(match[captureIndex])
  return matches
}

const setTodoStatusAtLineTo = (file: TFile, line: number, setTo: boolean) => {
  const fileContents = (file as any).cachedData
  if (!fileContents) return
  const fileLines = getAllLinesFromFile(fileContents)
  fileLines[line] = setLineTo(fileLines[line], setTo)
  return combineFileLines(fileLines)
}

const mapLinkMeta = (linkMeta: LinkMeta[]) => {
  const map = new Map<string, LinkMeta>()
  for (const link of linkMeta) map.set(link.filePath, link)
  return map
}

const isMacOS = () => {
  return os.platform() === "darwin"
}

/** REGEX */

const getTagMeta = (tag: string): TagMeta => {
  const [full, main, sub] = /^\#([^\/]+)\/?(.*)?$/.exec(tag)
  return { main, sub }
}

const setLineTo = (line: string, setTo: boolean) =>
  line.replace(/^(\s*\-\s\[)([^\]]+)(\].*$)/, `$1${setTo ? "x" : " "}$3`)

const getAllLinesFromFile = (cache: string) => cache.split(/\r?\n/)
const combineFileLines = (lines: string[]) => lines.join("\n")
const lineIsValidTodo = (line: string, tag: string) => {
  const tagRemoved = removeTagFromText(line, tag)
  return /^\s*\-\s\[(\s|x)\]\s*\S/.test(tagRemoved)
}
const extractTextFromTodoLine = (line: string) => /^\s*\-\s\[(\s|x)\]\s?(.*)$/.exec(line)?.[2]
const getIndentationSpacesFromTodoLine = (line: string) => /^(\s*)\-\s\[(\s|x)\]\s?.*$/.exec(line)?.[1]?.length ?? 0
const todoLineIsChecked = (line: string) => /^\s*\-\s\[x\]/.test(line)
const getFileLabelFromName = (filename: string) => /^(.+)\.md$/.exec(filename)?.[1]
const removeTagFromText = (text: string, tag: string) =>
  text.replace(new RegExp(`\\s?\\#${tag}[^\\s]*`, "g"), "").trim()
