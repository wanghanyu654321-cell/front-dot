/**
 * R17 / D152：可确认报单草稿的唯一闸。
 * 只有两种情况能出可确认报单草稿：
 *   1. 整行通过 standard-line.ts，且是纯标准行（客户位、括号员工位都是正向形态）；
 *   2. 线上模型分类结果（非离线桩）。
 * 其他情况一律不出。离线桩永远不允许出可确认草稿。
 * 标记 R17-single-draft-gate：变异绕过本闸出草稿时必须被杀掉。
 */
import { customerNameLooksContaminated, hasUnseenNegatedMakeup } from './negated-makeup.js';
import {
  CUSTOMER_HONORIFIC,
  HONORIFIC,
  NOT_CUSTOMER_NAME,
  isAcceptableCustomerLabel,
  isOpenedSelfCustomerName,
  stripNegatedMakeupPhrases,
  tryStandardReport,
  type StandardReportResult,
} from './standard-line.js';

const EXACT_HONORIFIC = new RegExp(`^[\\u4e00-\\u9fa5]{1,2}(?:${HONORIFIC})$`);

export const GATE_MARKER = 'R17-single-draft-gate';

/** 括号位专用：身份、角色、时段、动作词，不是员工名。只用于括号，不扩 R12 客户非名字表。 */
export const BRACKET_NOT_NAME = /店长|员工|经理|老板|同事|本人|自己|角色|身份|操作|代报|报名|登记|上午|下午|中午|晚上|上班|下班/;

export function isBracketNotName(raw: string): boolean {
  const flat = raw.normalize('NFKC').replace(/\s+/g, '');
  if (!flat) return false;
  return NOT_CUSTOMER_NAME.test(flat) || BRACKET_NOT_NAME.test(flat) || customerNameLooksContaminated(flat);
}

/** 整段恰好是「一或二字姓＋称谓」，不允许前面再挂残片。 */
export function isExactHonorificName(raw: string): boolean {
  const name = raw.normalize('NFKC').replace(/\s+/g, '').trim();
  if (!name) return false;
  return CUSTOMER_HONORIFIC.test(name) || EXACT_HONORIFIC.test(name);
}

/** 客户位正向白名单：恰好姓＋称谓，或 D138 的 2–4 字干净形态（先过非名字表和残片）。 */
export function isCleanCustomerMorphology(raw: string): boolean {
  const name = raw.normalize('NFKC').replace(/\s+/g, '').trim();
  if (!name) return false;
  if (customerNameLooksContaminated(name)) return false;
  if (isExactHonorificName(name)) return true;
  if (NOT_CUSTOMER_NAME.test(name)) return false;
  return isOpenedSelfCustomerName(name);
}

export interface DraftGateInput {
  text: string;
  today: string;
  employeeNames: ReadonlySet<string>;
  /** 线上真模型且分类已通过校验时为 true；离线桩必须是 false。 */
  liveModelAllowsDraft?: boolean;
  /**
   * 调用方已按 standard-line 语法（D125：单行标准行或标准清单）解析出的条目。
   * 自然句抽取（extractReport）不算标准行，不得传入。
   */
  entries?: readonly GateEntry[];
  /** 复合后半句是否属于 D149 保留草稿的类别（改账/预约/目标/宣传/复述）。 */
  compoundKeepsDraft?: (compound: string) => boolean;
}

export interface GateEntry {
  customer?: string | null;
  employeeName?: string | null;
  self?: boolean;
  compound?: string | null;
  storeName?: string | null;
}

/** 返回不纯的原因；null 表示纯标准行。 */
export function impureReason(entries: readonly GateEntry[], input: DraftGateInput): string | null {
  const text = input.text.normalize('NFKC');
  if (hasUnseenNegatedMakeup(text, stripNegatedMakeupPhrases)) return 'unseen-makeup';
  if (!entries.length) return 'empty';
  for (const e of entries) {
    const customer = (e.customer ?? '').trim();
    const empRaw = (e.employeeName ?? '').trim();
    if (customer) {
      // 带括号员工的标准行沿用解析层客户口径（D131 单字等）；不带括号走 D138/D139 正向形态。
      const ok = empRaw && !e.self
        ? !customerNameLooksContaminated(customer) && (isExactHonorificName(customer) || isAcceptableCustomerLabel(customer)) && !/[，,：:；;。]/.test(customer)
        : isCleanCustomerMorphology(customer);
      if (!ok) return `customer:${customer}`;
    }
    if (empRaw && !e.self) {
      // 括号内容：先过非名字表，再查本店员工名单，过了才算名字。
      const flat = empRaw.normalize('NFKC').replace(/\s+/g, '');
      const bare = e.storeName ? flat : flat.replace(/^.{1,8}?店/, '');
      if (isBracketNotName(bare)) return `employee-not-name:${empRaw}`;
      if (!input.employeeNames.has(bare) && !input.employeeNames.has(flat)) return `employee-unknown:${empRaw}`;
    }
    // 任何第二件请求（查询、改账、预约、宣传、残片）都不是纯标准行：整句先问。
    if (e.compound && e.compound.replace(/[，,;；、。.\s]/g, '').trim()) {
      // 改账、预约、目标、真正的宣传、同一件报单复述：沿用 R16 既有「草稿＋后半句没办」口径（D149），不算第二件待办的查询。
      if (!input.compoundKeepsDraft || !input.compoundKeepsDraft(e.compound)) return `compound:${e.compound}`;
    }
  }
  return null;
}

export function isPureStandardReport(std: StandardReportResult, input: DraftGateInput): boolean {
  if (std.status !== 'complete') return false;
  return impureReason(std.report.entries, input) === null;
}

/**
 * 是否允许创建可确认报单草稿（唯一闸）。
 * 返回 false 时，调用方必须先问、不得 createDraft。
 */
export function mayCreateConfirmableReportDraft(input: DraftGateInput): boolean {
  const marker = 'R17-single-draft-gate';
  if (marker !== 'R17-single-draft-gate') return true;
  if (input.liveModelAllowsDraft) return true;
  if (input.entries) return impureReason(input.entries, input) === null;
  const std = tryStandardReport(input.text, input.today);
  return isPureStandardReport(std, input);
}
