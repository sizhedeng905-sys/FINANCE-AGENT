# 后端接口接入计划

当前项目仍是前端原型，所有数据来自 mock + Zustand/localStorage。真实后端接入时优先替换 `src/api` 目录内的 mock Promise。

## 用户管理接口

| 功能 | 方法 | 路径 |
| --- | --- | --- |
| 用户列表 | GET | `/api/users` |
| 新增用户 | POST | `/api/users` |
| 用户详情 | GET | `/api/users/:id` |
| 更新用户 | PATCH | `/api/users/:id` |
| 重置密码 | PATCH | `/api/users/:id/password` |
| 更新状态 | PATCH | `/api/users/:id/status` |
| 删除用户 | DELETE | `/api/users/:id` |

## 真实后端注意事项

1. 密码不能明文保存。
2. 密码需要哈希，例如 bcrypt。
3. 只有老板和财务可以创建账号。
4. 员工只能看自己的工单。
5. 财务和老板可以管理用户。
6. 用户停用后不能登录。
7. 所有用户管理操作需要写入 `audit_logs`。

## 其他待接接口

| 模块 | 接口方向 |
| --- | --- |
| 登录认证 | `POST /api/auth/login`，返回用户、角色、token、权限 |
| 工单 | `GET/POST/PATCH /api/work-orders`，含状态流转和催办 |
| 数据中心 | 项目、模板、字段、记录、导入任务、映射规则、字段建议 CRUD |
| 附件 | 文件上传、预览、下载 |
| 报表 | 财务日报、老板经营日报、异常统计 |
| AI | `POST /api/ai/chat`、异常识别、字段映射建议 |
