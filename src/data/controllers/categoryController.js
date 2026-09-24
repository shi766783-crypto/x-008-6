import { storage } from '../../core/storage.js'
import { uid } from '../../core/utils.js'
import { STORAGE_KEYS, TRANSACTION_TYPES, INCOME_CATEGORIES, EXPENSE_CATEGORIES, CATEGORY_NAME_MAX } from '../../core/constants.js'
import { loadTransactions, saveTransactions } from './transactionController.js'
import { loadBudgets, saveBudgets } from './budgetController.js'

// 类别注册表：{ id, name, type: 'income'|'expense', builtin, disabled, createdAt }
// 流水与预算仍按类别「名称」引用，因此：
// - 停用：不改写任何历史数据，历史流水仍显示原名称，已设预算保留并继续统计
// - 改名：同步迁移同名流水与预算，保证统计与预算进度不断裂

function seedBuiltins() {
  const now = Date.now()
  const mk = (name, type) => ({ id: uid(), name, type, builtin: true, disabled: false, createdAt: now })
  return [
    ...INCOME_CATEGORIES.map((n) => mk(n, TRANSACTION_TYPES.INCOME)),
    ...EXPENSE_CATEGORIES.map((n) => mk(n, TRANSACTION_TYPES.EXPENSE))
  ]
}

export function loadCategories() {
  let list = storage.getJSON(STORAGE_KEYS.categories)
  if (!Array.isArray(list) || list.length === 0) {
    list = seedBuiltins()
    saveCategories(list)
  }
  return list
}

export function saveCategories(list) {
  storage.setJSON(STORAGE_KEYS.categories, list)
}

export function listCategories(type) {
  const all = loadCategories()
  return type ? all.filter((c) => c.type === type) : all
}

export function activeCategories(type) {
  return listCategories(type).filter((c) => !c.disabled)
}

export function activeNames(type) {
  return activeCategories(type).map((c) => c.name)
}

export function findCategory(type, name) {
  return loadCategories().find((c) => c.type === type && c.name === name) || null
}

export function isDisabledName(type, name) {
  return Boolean(findCategory(type, name)?.disabled)
}

function validateName(name, type, excludeId = null) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return '类别名称不能为空'
  if (trimmed.length > CATEGORY_NAME_MAX) return `类别名称不能超过 ${CATEGORY_NAME_MAX} 个字`
  const dup = loadCategories().some((c) => c.type === type && c.name === trimmed && c.id !== excludeId)
  if (dup) return '同类型下已存在同名类别'
  return ''
}

export function addCategory({ name, type }) {
  const trimmed = String(name || '').trim()
  const error = validateName(trimmed, type)
  if (error) return { ok: false, error }
  const category = { id: uid(), name: trimmed, type, builtin: false, disabled: false, createdAt: Date.now() }
  saveCategories([...loadCategories(), category])
  return { ok: true, category }
}

// 改名 = 迁移：同步改写同类型的历史流水与（支出类）预算为新名称。
// 若某月预算与新名称类别已有预算撞名，则合并限额，避免同一月出现两条同类预算。
export function renameCategory(id, newName) {
  const list = loadCategories()
  const target = list.find((c) => c.id === id)
  if (!target) return { ok: false, error: '类别不存在' }
  const trimmed = String(newName || '').trim()
  const error = validateName(trimmed, target.type, id)
  if (error) return { ok: false, error }
  const oldName = target.name
  if (trimmed === oldName) return { ok: true, category: target }

  saveCategories(list.map((c) => (c.id === id ? { ...c, name: trimmed } : c)))

  saveTransactions(
    loadTransactions().map((t) =>
      t.type === target.type && t.category === oldName ? { ...t, category: trimmed } : t
    )
  )

  if (target.type === TRANSACTION_TYPES.EXPENSE) {
    // 先统一改名，再按「类别+月份」去重合并，避免遗留预算在数组后部时漏并
    const renamed = loadBudgets().map((b) => (b.category === oldName ? { ...b, category: trimmed } : b))
    const merged = []
    for (const b of renamed) {
      const clash = b.category === trimmed ? merged.find((x) => x.category === trimmed && x.month === b.month) : null
      if (clash) clash.limit = Number(clash.limit || 0) + Number(b.limit || 0)
      else merged.push(b)
    }
    saveBudgets(merged)
  }
  return { ok: true, category: { ...target, name: trimmed } }
}

// 停用 = 保留：仅翻转标志位。历史流水仍显示原名称；已设预算保留并继续统计，
// 只是新建记账 / 预算的下拉选项中不再出现该类别。
export function setCategoryDisabled(id, disabled) {
  const list = loadCategories()
  if (!list.some((c) => c.id === id)) return false
  saveCategories(list.map((c) => (c.id === id ? { ...c, disabled: Boolean(disabled) } : c)))
  return true
}
