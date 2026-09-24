<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>月度预算</h2>
        <p class="page-sub">按支出类别设定上限，实时监控进度</p>
      </div>
    </div>

    <div class="card summary-bar">
      <div>
        <span class="summary-label">本月总预算</span>
        <div class="summary-value">¥{{ money(totalLimit) }}</div>
      </div>
      <div>
        <span class="summary-label">已用</span>
        <div class="summary-value">{{ money(totalUsed) }}</div>
      </div>
      <div>
        <span class="summary-label">剩余</span>
        <div class="summary-value" :class="{ neg: remaining < 0 }">{{ money(remaining) }}</div>
      </div>
    </div>

    <div class="budget-list">
      <div v-for="item in views" :key="item.id" class="card budget-item">
        <div class="budget-row">
          <span class="budget-cat">
            {{ item.category }}
            <em v-if="item.catDisabled" class="off-badge">已停用</em>
          </span>
          <span class="budget-nums">
            <b>{{ money(item.used) }}</b> / {{ money(item.limit) }}
            <em :class="statusClass(item)">{{ statusText(item) }}</em>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar" :class="statusClass(item)" :style="{ width: Math.min(100, item.percent) + '%' }"></div>
        </div>
        <div class="budget-foot">
          <span class="muted">剩余 {{ money(item.remaining) }}</span>
          <button class="link-btn" @click="openEdit(item)">修改</button>
        </div>
      </div>
    </div>

    <div class="card setup-card">
      <div class="setup-head">
        <h3>设置本类预算</h3>
        <button class="link-btn" @click="managerOpen = true">管理类别</button>
      </div>
      <form class="setup-form" @submit.prevent="applySetup">
        <select v-model="setup.category">
          <option v-if="activeExpense.length === 0" value="" disabled>暂无可用类别，请先新增</option>
          <option v-for="c in activeExpense" :key="c.id" :value="c.name">{{ c.name }}</option>
        </select>
        <input v-model.number="setup.limit" type="number" min="0" step="0.01" placeholder="每月预算上限" />
        <button class="btn btn-primary" type="submit">保存预算</button>
      </form>
      <div class="chips">
        <button v-for="b in allBudgets" :key="b.id" class="chip" @click="quickEdit(b)">
          {{ b.category }}{{ disabledNames.has(b.category) ? '（已停用）' : '' }} ¥{{ money(b.limit) }}
        </button>
      </div>
    </div>

    <Modal title="修改预算" @close="modalOpen = false" v-if="modalOpen">
      <form id="budget-form" @submit.prevent="saveEdit" class="form">
        <div class="field">
          <span>类别</span>
          <input :value="editing?.category" disabled />
        </div>
        <label class="field">
          <span>月度上限</span>
          <input v-model.number="editLimit" type="number" min="0" step="0.01" required />
        </label>
      </form>

        <template #footer>
          <button type="button" class="btn" @click="modalOpen = false">取消</button>
          <button type="submit" class="btn btn-primary" form="budget-form">保存</button>
        </template>
    </Modal>

    <CategoryManager v-if="managerOpen" @close="managerOpen = false" />
  </div>
</template>

<script setup>
import { reactive, ref, computed, watchEffect } from 'vue'
import { useStore, refreshKeys, controllersApi } from '../data/store.js'
import { money } from '../core/utils.js'
import { BUDGET_WARN_RATIO } from '../core/constants.js'
import Modal from '../components/Modal.vue'
import CategoryManager from '../components/CategoryManager.vue'

const store = useStore()
const { budget: budgetApi } = controllersApi

const currentMonth = new Date().toISOString().slice(0, 7)
const setup = reactive({ category: '', limit: '' })
const modalOpen = ref(false)
const managerOpen = ref(false)
const editing = ref(null)
const editLimit = ref('')

// 预算设置只列启用中的支出类别；已停用类别的存量预算保留并标注
const activeExpense = computed(() => store.categories.filter((c) => c.type === 'expense' && !c.disabled))
const disabledNames = computed(() => new Set(store.categories.filter((c) => c.type === 'expense' && c.disabled).map((c) => c.name)))

watchEffect(() => {
  const names = activeExpense.value.map((c) => c.name)
  if (!names.includes(setup.category)) setup.category = names[0] || ''
})

const allBudgets = computed(() => store.budgets.filter((b) => b.month === currentMonth))
const views = computed(() =>
  allBudgets.value
    .map((b) => {
      const used = store.transactions
        .filter((t) => t.type === 'expense' && t.category === b.category && t.date.startsWith(currentMonth))
        .reduce((s, t) => s + t.amount, 0)
      const limit = b.limit
      const percent = limit > 0 ? Math.round((used / limit) * 100) : 0
      return { ...b, used, percent, remaining: limit - used, catDisabled: disabledNames.value.has(b.category) }
    })
    .sort((a, b) => b.percent - a.percent)
)
const totalLimit = computed(() => allBudgets.value.reduce((s, b) => s + b.limit, 0))
const totalUsed = computed(() => store.transactions.filter((t) => t.type === 'expense' && t.date.startsWith(currentMonth)).reduce((s, t) => s + t.amount, 0))
const remaining = computed(() => totalLimit.value - totalUsed.value)

const statusClass = (item) => (item.percent > 100 ? 'danger' : item.percent >= BUDGET_WARN_RATIO * 100 ? 'warn' : 'ok')
const statusText = (item) => (item.percent > 100 ? '超支' : item.percent >= BUDGET_WARN_RATIO * 100 ? '预警' : `已用 ${item.percent}%`)

const applySetup = () => {
  if (!setup.category || !setup.limit || Number(setup.limit) <= 0) return
  budgetApi.upsertBudget(setup.category, currentMonth, setup.limit)
  refreshKeys('budgets')
  setup.limit = ''
}
const quickEdit = (b) => {
  editing.value = b
  editLimit.value = b.limit
  modalOpen.value = true
}
const openEdit = (item) => quickEdit(item)
const saveEdit = () => {
  budgetApi.upsertBudget(editing.value.category, currentMonth, editLimit.value)
  refreshKeys('budgets')
  modalOpen.value = false
}
</script>

<style scoped>
.summary-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.summary-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.summary-value {
  font-size: 22px;
  font-weight: 800;
  margin-top: 4px;
}
.summary-value.neg { color: var(--expense); }
.budget-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.budget-item {
  padding: 14px 16px;
}
.budget-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.budget-cat {
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.off-badge {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--expense);
  background: rgba(244, 91, 105, 0.12);
}
.budget-nums {
  font-size: 13px;
  color: var(--text-secondary);
}
.budget-nums em {
  font-style: normal;
  font-weight: 700;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.budget-nums em.ok { background: rgba(87, 199, 133, 0.15); color: var(--income); }
.budget-nums em.warn { background: rgba(240, 201, 87, 0.18); color: #b8860b; }
.budget-nums em.danger { background: rgba(244, 91, 105, 0.15); color: var(--expense); }
.bar-track {
  height: 10px;
  background: var(--bg-elevated);
  border-radius: 999px;
  overflow: hidden;
}
.bar {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.bar.ok { background: linear-gradient(90deg, #57c785, #3aa66f); }
.bar.warn { background: linear-gradient(90deg, #f0c957, #e0a41f); }
.bar.danger { background: linear-gradient(90deg, #f45b69, #d63a4a); }
.budget-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.setup-card {
  max-width: 560px;
}
.setup-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.setup-head h3 {
  margin: 0;
}
.setup-form {
  display: flex;
  gap: 10px;
  margin: 10px 0 12px;
  flex-wrap: wrap;
}
.setup-form select,
.setup-form input {
  flex: 1;
  min-width: 140px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.chip:hover { border-color: var(--accent); }
</style>
