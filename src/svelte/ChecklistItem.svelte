<script lang="ts">
  import type { App } from "obsidian"

  import type { LookAndFeel, TodoItem } from "src/_types"
  import { navToFile, toggleTodoItem } from "src/_utils"
  import CheckCircle from "./CheckCircle.svelte"
  import TextChunk from "./TextChunk.svelte"

  export let item: TodoItem
  export let lookAndFeel: LookAndFeel
  export let app: App

  const toggleItem = async (item: TodoItem) => {
    toggleTodoItem(item, app)
  }
</script>

<li class={`${lookAndFeel}`} on:click={(ev) => navToFile(app, item.filePath, ev)}>
  <button
    class="toggle"
    on:click={(ev) => {
      toggleItem(item)
      ev.stopPropagation()
    }}
  >
    <CheckCircle checked={item.checked} />
  </button>
  <div class="content">
    <TextChunk chunks={item.display} {app} />
  </div>
</li>

<style>
  li {
    display: flex;
    align-items: center;
    background-color: var(--interactive-normal);
    border-radius: var(--todoList-listItemBorderRadius);
    margin: var(--todoList-listItemMargin);
    cursor: pointer;
    transition: background-color 100ms ease-in-out;
  }
  li:hover {
    background-color: var(--interactive-hover);
  }
  .toggle {
    padding: var(--todoList-togglePadding);
  }
  .content {
    padding: var(--todoList-contentPadding)
  }
  .compact {
    bottom: var(--todoList-listItemMargin--compact);
  }
  .compact > .content {
    padding: var(--todoList-contentPadding--compact);
  }
  .compact > .toggle {
    padding: var(--todoList-togglePadding--compact);
  }
  .toggle:hover {
    opacity: 0.8;
  }
</style>
