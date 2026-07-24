# CR-050 OCR provider raster evidence

## 目标

修复本地 PaddleOCR-VL 返回的证据坐标与后端页面尺寸可能不在同一坐标系的问题。OCR 证据必须使用 Provider 实际推理所见栅格的宽高，不能用上传文件的原始尺寸代替。

## 根因

- Paddle 适配器已经基于实际栅格生成 bbox，但响应没有返回对应页面宽高。
- 后端使用上传图片或 PDF 渲染前的尺寸构建 OCR IR。
- 当 Provider 内部缩放、旋转或重新栅格化时，bbox 与页面尺寸可能不一致，前端高亮会发生偏移。

## 修改

- Paddle 适配器在每页结果中返回经过严格有限整数校验的 `width` 和 `height`。
- 本地 OCR Provider 严格校验页序号、宽高和返回结构。
- OCR IR 使用 Provider 返回的页面尺寸，同时保留既有页序号和证据引用。
- 增加适配器和 NestJS 单元测试，覆盖有效尺寸、非法尺寸和页序号映射。

## 边界

- 不改变 OCR 文字内容、置信度或业务批准规则。
- 不引入自动旋转、自动纠错或无证据字段。
- 真实 OCR 准确率仍需要授权真值样本验收；本提交只修复几何证据契约。

## 测试证据

- Paddle 适配器：9/9 tests passed。
- OCR/模型定向回归：42/42 tests passed。
- 后端全量单元：52 suites，479/479 tests passed。
- PostgreSQL/Redis：125 total，111 passed，14 skipped，0 failed。
- Playwright：22/22 passed。

## 回滚

使用 `git revert <CR-050-sha>`。回滚不会修改数据库，但会恢复 bbox 与 Provider 栅格尺寸可能不一致的风险。
