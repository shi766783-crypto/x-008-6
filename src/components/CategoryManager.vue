<template>
  <Modal title="类别管理" @close="$emit('close')">
    <div class="seg">
      <button type="button" class="seg-btn wide" :class="{ active: tab === 'expense' }" @click="tab = 'expense'">支出类别</button>
      <button type="button" class="seg-btn wide" :class="{ active: tab === 'income' }" @click="tab = 'income'">收入类别</button>
    </div>

    <form class="add-row" @submit.prevent="add">
      <input v-model="newName" :maxlength="NAME_MAX" :placeholder="tab === 'income' ? '新增收入类别，如：退税' : '新增支出类别，如：宠物'" />
      <button class="btn btn-primary" type="submit">添加</button>
    </form>

    <div class="cat-list">
      <div v-for="c in visible" :key="c.id" class="cat-row" :class="{ off: c.disabled }">
        <template v-if="renamingId === c.id">
          <input v-model="renameValue" class="rename-input" :maxlength="NAME_MAX" @keyup.enter="saveRename(c)" @keyup.esc="cancelRename" />
          <span class="row-actions">
            <button type="button" class="link-btn" @click="saveRename(c)">保存</button>
            <button type="button" class="link-btn" @click="cancelRename">取消</button>
          </span>
        </template>
        <template v-else>
          <span class="cat-name">{{ c.name }}</span>
          <span v-if="c.builtin" class="badge">内置</span>
          <span v-if="c.disabled" class="badge badge-off">已停用</span>
          <span class="row-actions">
            <button type="button" class="link-btn" @click="startRename(c)">改名</button>
            <button type="button" class="link-btn" :class="{ danger: !c.disabled }" @click="toggle(c)">{{ c.disabled ? '启用' : '停用' }}</button>
          </span>
        </template>
      </div>
      <div v-if="visible.length === 0" class="empty-row">暂无类别，先添加一个吧</div>
    </div>

    <p class="hint">
      改名：历史流水和已设预算会同步迁移为新名称。<br />
      停用：记账和预算设置中不再可选；历史流水仍显示原名称，已设预算保留并继续统计。
    </p>
  </Modal>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useStore, refreshKeys, controllersApi } from '../data/store.js'
import { CATEGORY_NAME_MAX } from '../core/constants.js'
import Modal from './Modal.vue'

defineEmits(['close'])

const store = useStore()
const { category: catApi } = controllersApi

const NAME_MAX = CATEGORY_NAME_MAX
const tab = ref('expense')
const newName = ref('')
const renamingId = ref('')
const renameValue = ref('')

const visible = computed(() => store.categories.filter((c) => c.type === tab.value))

// 改名会迁移流水与预算，停用只影响类别本身，统一刷新这三块数据
const refresh = () => refreshKeys('categories', 'transactions', 'budgets')

const add = () => {
  const res = catApi.addCategory({ name: newName.value, type: tab.value })
  if (!res.ok) {
    alert(res.error)
    return
  }
  newName.value = ''
  refresh()
}

const startRename = (c) => {
  renamingId.value = c.id
  renameValue.value = c.name
}
const cancelRename = () => {
  renamingId.value = ''
  renameValue.value = ''
}
const saveRename = (c) => {
  const trimmed = renameValue.value.trim()
  if (trimmed && trimmed !== c.name && !window.confirm(`确定将「${c.name}」改名为「${trimmed}」吗？\n该类别的历史流水和已设预算将同步迁移为新名称。`)) return
  const res = catApi.renameCategory(c.id, trimmed)
  if (!res.ok) {
    alert(res.error)
    return
  }
  cancelRename()
  refresh()
}

const toggle = (c) => {
  if (!c.disabled) {
    const ok = window.confirm(
      `停用「${c.name}」后：\n· 记账和预算设置中将不再出现该类别\n· 历史流水仍显示「${c.name}」原名称\n· 已按该类别设置的预算保留并继续统计\n\n确认停用吗？`
    )
    if (!ok) return
  }
  catApi.setCategoryDisabled(c.id, !c.disabled)
  refresh()
}
</script>

<style scoped>
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.add-row input {
  flex: 1;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.add-row input:focus {
  border-color: var(--accent);
}
.cat-list {
  display: flex;
  flex-direction: column;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
}
.cat-row:last-child {
  border-bottom: none;
}
.cat-row.off .cat-name {
  color: var(--text-secondary);
}
.cat-name {
  font-weight: 600;
}
.badge-off {
  color: var(--expense);
  background: rgba(244, 91, 105, 0.12);
}
.row-actions {
  margin-left: auto;
  display: flex;
  gap: 12px;
}
.rename-input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.empty-row {
  text-align: center;
  color: var(--text-secondary);
  padding: 16px 0;
  font-size: 13px;
}
.hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
