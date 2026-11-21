# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.16-local.1

### 中文

**修复**

- 修复库内谱面的自定义 shader 无法加载的问题：打开库项目时绑定该文档的资产表，着色器源码读取不到时回落到这份资产表，预览不再报 `preview_frame_shader_unavailable`。
- 着色器管道的画布上传完成后复位 `UNPACK_FLIP_Y_WEBGL`，避免影响同上下文后续的贴图上传。

### English

**Fixes**

- Custom shaders of library projects now load: opening a library document binds its asset map, and the shader source reader falls back to that map, so the preview no longer reports `preview_frame_shader_unavailable`.
- The shader pipeline resets `UNPACK_FLIP_Y_WEBGL` after each canvas upload so later texture uploads in the same context are unaffected.
