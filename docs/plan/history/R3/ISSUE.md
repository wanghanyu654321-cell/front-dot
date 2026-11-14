# R3 ISSUE（2026-11-12 05:20 UTC+8 开工）

起点：R2a 树 `6fcd27659ce4d7c149a8a4887e72c7ebc284d9c0`；基线 G = `f2a8105acf84ac0679b3a0f4b86c973d03e1781a`。
工作树：`<WORKSPACE>/fc-migration/repo-r3`（G 上建 worktree，再 read-tree 6fcd2765）。产物放 `<WORKSPACE>/fc-migration/R3/`。
依据：`audit/REVIEW-R1-R2-R2a.md`（Codex牙），复现用例 `audit/wt/r2a/tests/audit/*`（已原样复制到 `tests/audit/`）。
证据副本：`audit/test-output/r2a-audit/` → `R3/audit-copy/`。audit/ 只读，RESUME.md 不动。

| # | 问题 | 来源 |
|---|---|---|
| 1 | A-P1-1：B 接管租约后，旧消费者 A 仍能新建草稿、作废 pending 草稿（另有 finalReply 回写、操作记录 setConfig 没有 fence） | REVIEW §2，pg-stale-writes 2 项失败 |
| 2 | A-P1-2：M07 启动超时没覆盖动态 import 和模块初始化；同步死循环无法用计时器隔离 | REVIEW §2 |
| 3 | 通知 f 不单调：重试、终态、unknown 后人工补发都会把 f 丢回 0，下次领取又从 1 开始 | REVIEW A-P2-1 |
| 4 | 该拒绝却回澄清：B031/B049/B050/B066 | REVIEW A-P2-3 |
| 5 | B035 复合句的后半句「（评测原句已删）」被丢掉 | REVIEW §4 |
| 6 | 产品三点：D85 提醒发给报单人；D81 非今天的单回固定说明；客套话简短回复 | hanyu / 产品 |
| 7 | 文档：D78、D83、D84 的表述更正 | REVIEW §6 |

群里补充（steering）：
- 统一带 epoch 的写入入口，另加静态检查。
- 异步卡住：后加载 + 超时标为不可用 + 告警；同步死循环用子进程证明会卡死，列为剩余 P2。
- f 由数据库 `f = f + 1` 递增。
- 复合句要么两个动作都做完，要么明说哪部分没做。
- 越权说法直接回「不能」并说明原因。

不做：A-P1-3（真实模型、真实 OpenDot 验收）；v8 是否部署过。这两项只在 REPORT 里列为未决。
