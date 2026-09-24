import { storage } from '../../core/storage.js'
import { uid } from '../../core/utils.js'
import { STORAGE_KEYS, TRANSACTION_TYPES, DEFAULT_INCOME_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES } from '../../core/constants.js'
import { loadTransactions, saveTransactions } from './transactionController.js'
import { loadBudgets, saveBudgets } from './budgetController.js'

export const MAX_CATEGORY_NAME_LENGTH = 10

const DEFAULT_CATEGORY_DEFS = [
  ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ name, type: TRANSACTION_TYPES.INCOME })),
  ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name, type: TRANSACTION_TYPES.EXPENSE }))
]

function makeCategory(name, type, builtin = false) {
  return {
    id: builtin ? `cat-${type}-${name}` : uid(),
    name,
    type,
    active: true,
    builtin,
    createdAt: Date.now()
  }
}

export function defaultCategories() {
  return DEFAULT_CATEGORY_DEFS.map((d) => makeCategory(d.name, d.type, true))
}

export function loadRawCategories() {
  return storage.getJSON(STORAGE_KEYS.categories) || []
}

export function saveCategories(categories) {
  storage.setJSON(STORAGE_KEYS.categories, categories)
}

/**
 * 幂等初始化：
 * 1. 首次使用时写入内置类别；
 * 2. 把历史流水 / 预算中出现的未知类别名自动注册为自定义类别，
 *    这样升级前的老数据在停用、改名后仍能正常显示原名称。
 */
export function ensureCategories() {
  let categories = loadRawCategories()
  let changed = false
  if (!categories.length) {
    categories = defaultCategories()
    changed = true
  }
  const hasName = (type, name) => categories.some((c) => c.type === type && c.name === name)

  for (const t of loadTransactions()) {
    if (t.type === TRANSACTION_TYPES.TRANSFER || !t.category) continue
    if (!hasName(t.type, t.category)) {
      categories.push(makeCategory(t.category, t.type))
      changed = true
    }
  }
  for (const b of loadBudgets()) {
    if (b.category && !hasName(TRANSACTION_TYPES.EXPENSE, b.category)) {
      categories.push(makeCategory(b.category, TRANSACTION_TYPES.EXPENSE))
      changed = true
    }
  }
  if (changed) saveCategories(categories)
  return categories
}

export function loadCategories() {
  const categories = loadRawCategories()
  return categories.length ? categories : ensureCategories()
}

export function categoriesOf(type, { includeInactive = false } = {}) {
  return loadCategories().filter((c) => c.type === type && (includeInactive || c.active))
}

export function findCategory(type, name) {
  return loadCategories().find((c) => c.type === type && c.name === name) || null
}

export function isActiveCategory(type, name) {
  const category = findCategory(type, name)
  return Boolean(category && category.active)
}

/** 该类别目前被多少条流水 / 预算引用，用于管理界面提示 */
export function categoryUsage(category) {
  const txCount = loadTransactions().filter((t) => t.type === category.type && t.category === category.name).length
  const budgets = category.type === TRANSACTION_TYPES.EXPENSE ? loadBudgets().filter((b) => b.category === category.name) : []
  return { transactions: txCount, budgets: budgets.length, budgetMonths: new Set(budgets.map((b) => b.month)).size }
}

function validateName(rawName, categories, type, excludeId = null) {
  const name = String(rawName || '').trim()
  if (!name) return { error: '请输入类别名称' }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) return { error: `类别名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字` }
  if (categories.some((c) => c.type === type && c.name === name && c.id !== excludeId)) {
    return { error: `「${name}」已存在，请换一个名称` }
  }
  return { name }
}

export function addCategory(type, name) {
  const categories = loadCategories()
  const check = validateName(name, categories, type)
  if (check.error) return check
  const category = makeCategory(check.name, type)
  saveCategories([...categories, category])
  return { category }
}

/**
 * 改名：类别名是流水和预算的关联键，因此同步更新历史流水与预算，
 * 保证统计口径一致（停用不改名称，历史记录仍保留原名称）。
 */
export function renameCategory(id, newName) {
  const categories = loadCategories()
  const category = categories.find((c) => c.id === id)
  if (!category) return { error: '类别不存在' }
  const check = validateName(newName, categories, category.type, id)
  if (check.error) return check
  if (check.name === category.name) return { category, renamed: false }

  const oldName = category.name
  saveCategories(categories.map((c) => (c.id === id ? { ...c, name: check.name } : c)))

  const transactions = loadTransactions().map((t) =>
    t.type === category.type && t.category === oldName ? { ...t, category: check.name } : t
  )
  saveTransactions(transactions)
  if (category.type === TRANSACTION_TYPES.EXPENSE) {
    saveBudgets(loadBudgets().map((b) => (b.category === oldName ? { ...b, category: check.name } : b)))
  }
  return { category: { ...category, name: check.name }, renamed: true, oldName }
}

/**
 * 停用类别：不再出现在新记账 / 新预算的选项中，但不删除数据，
 * 历史流水仍显示原名称。
 *
 * 已设置预算的处理方式由调用方明确选择：
 * - budgetStrategy 'keep'（默认）：保留预算，继续按历史支出统计，
 *   并标记“已停用”，不能再为该类别新增预算；
 * - budgetStrategy 'migrate'：所有月份的预算迁移到目标启用类别，
 *   同一月份两边都有预算时限额自动合并。
 */
export function disableCategory(id, { budgetStrategy = 'keep', migrateTo = '' } = {}) {
  const categories = loadCategories()
  const category = categories.find((c) => c.id === id)
  if (!category) return { error: '类别不存在' }
  if (!category.active) return { category, changed: false }

  const budgets = loadBudgets()
  const affected = budgets.filter((b) => b.category === category.name)
  let nextBudgets = budgets
  let migratedMonths = 0

  if (budgetStrategy === 'migrate') {
    if (category.type !== TRANSACTION_TYPES.EXPENSE) return { error: '只有支出类别可以迁移预算' }
    const target = categories.find((c) => c.type === category.type && c.active && c.id !== id && c.name === migrateTo)
    if (!target) return { error: '请选择要迁移到的启用中类别' }
    if (affected.length) {
      const merged = []
      for (const b of budgets) {
        if (b.category !== category.name) {
          merged.push(b)
          continue
        }
        const existing = merged.find((x) => x.month === b.month && x.category === target.name)
        if (existing) {
          existing.limit = Number(existing.limit) + Number(b.limit)
        } else {
          merged.push({ ...b, category: target.name })
        }
      }
      nextBudgets = merged
      migratedMonths = new Set(affected.map((b) => b.month)).size
    }
  }

  saveCategories(categories.map((c) => (c.id === id ? { ...c, active: false } : c)))
  if (nextBudgets !== budgets) saveBudgets(nextBudgets)
  return {
    category: { ...category, active: false },
    changed: true,
    budgetCount: affected.length,
    migratedMonths,
    migratedTo: budgetStrategy === 'migrate' ? migrateTo : ''
  }
}

export function enableCategory(id) {
  const categories = loadCategories()
  const category = categories.find((c) => c.id === id)
  if (!category) return { error: '类别不存在' }
  if (category.active) return { category, changed: false }
  saveCategories(categories.map((c) => (c.id === id ? { ...c, active: true } : c)))
  return { category: { ...category, active: true }, changed: true }
}
