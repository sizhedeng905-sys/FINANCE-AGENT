# CR-018: fast-uri Security Patch

提交：`b89c61133aba81cc01ba7ceb2d19684babd19139 fix: update fast-uri security patch`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 触发原因

- 远端 Build and acceptance run `29882733387` 在 production dependency audit 阶段失败。
- CI 报告 `fast-uri 3.1.3` 命中高危 `GHSA-v2hh-gcrm-f6hx`；同一 run 的 CodeQL `29882733374` 通过。
- 后续 R5 artifact 空目录错误是前序门禁中止的连带结果，不冒充独立通过或独立根因。

## 范围

- 仅更新 `backend/package-lock.json`：`fast-uri 3.1.3 -> 3.1.4`。
- 不改直接依赖声明、业务逻辑、API、数据库或 Demo 数据。

## 验证

- 根目录 `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- 后端 `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `npm ls fast-uri --omit=dev`：AJV 使用 `fast-uri@3.1.4`。
- 后端单元：50 suites / 464 tests PASS。
- staged repository hygiene：PASS。

## 风险与回退

- 这是传递依赖的 patch 更新；AJV 的对外版本保持不变。
- 回退会重新引入已被 CI 阻断的高危版本，因此只允许在有等价上游修复时替换，不应直接降回 3.1.3。
- 仍需以新 HEAD 的远端 audit、Build and acceptance 和 CodeQL 结果作为关闭证据。
