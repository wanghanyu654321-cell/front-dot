# 运行记录格式

每次真实运行新建时间目录。`steps.json` 顶层字段为 version、backend、steps；每个 step 含 step、command（固定脱敏模板）、exitCode、durationMs、counts，失败时含稳定错误码和可选断言名。`summary.json` 含 version、backend、status、gates、steps、failures。

只记录实际执行结果。备份与查询正文存临时目录并随环境清理。日志模板使用 `<tmp>`、`<repo>` 等占位，不保存真实路径、账号、地址或口令。门禁状态固定为“未复跑（需授权语料）”，获得授权并实际复跑后由执行人只补充计数和比对结论。
