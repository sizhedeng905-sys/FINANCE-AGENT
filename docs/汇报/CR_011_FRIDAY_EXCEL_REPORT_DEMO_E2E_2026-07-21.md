# CR-011 周五 Excel 到经营报告演示 E2E 报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

## 演示故事

1. 财务 A 选择太和中转项目、运输费用模板、工作表和第一行表头，上传三行合成 Excel。
2. 两行是普通金额，一行是公式缓存金额；系统不执行公式，明确展示 warning。
3. 财务 A 不能自审批。批准前正式 records、项目 structure 和老板报告金额不变化，通用记录接口也不能修改未来记录。
4. 财务 B 重新读取任务、重新校验、确认 warning，再批准入库。
5. 同一批准命令重放返回同一结果，最终只生成 3 条记录。
6. 页面跳转到正式记录列表；老板报告和审计快照增加 `13422.21` 元、3 条来源。
7. 测试从 Snapshot source rows 重算 `sourceDigest`，并重算 canonical `snapshotHash`，均匹配服务端。

## 人工真值

| 行 | 金额 | 证据类型 |
| --- | ---: | --- |
| 2 | 1250.25 | 普通单元格 |
| 3 | 8765.43 | 公式缓存，必须人工确认 warning |
| 4 | 3406.53 | 普通单元格 |
| 合计 | 13422.21 | bigint 分币求和 |

## 自动化证据

- 单条演示 E2E：PASS，1/1。
- 完整 Playwright：PASS，18/18。
- 后端单元：PASS，50 suites / 464 tests。
- PostgreSQL + 强制 Redis：PASS，14 suites / 124 tests。
- migration 双路径：PASS，43 migrations。
- 前后端构建、runtime 4/4、两套 production audit：PASS。
- teardown：测试记录、任务、快照、文件引用与磁盘文件均清理。

## 结论

自动化演示故事线为 `LOCAL_ENGINEERING_VERIFIED`。它证明合成数据下的确定性业务闭环，不证明真实公司数据准确率、OCR 真实效果、AI 自动判断或 production-ready。CR-011 远端 CI 待新 SHA 验证；人工三次现场演练在任务 C 运行包完成后执行并如实记录。
