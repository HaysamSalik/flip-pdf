# Security

## What this library does with your PDF

The PDF is fetched by the browser and rendered locally by PDF.js. No file, page
image or extracted text is sent anywhere by this plugin. There is no backend and
no telemetry.

PDF.js runs in a worker. This plugin sets `isEvalSupported: false` when opening a
document, which turns off PDF.js's JIT path for its font and function handling.

## Reporting a vulnerability

Open a private report through the repository's **Security** tab, using
"Report a vulnerability". That keeps the details out of public issues until there
is a fix.

Please include the browser and version, and ideally a minimal PDF that triggers
the problem. If the file is sensitive, describe how to construct it instead.

## What counts

In scope:

- A crafted PDF that causes script execution, rather than a rendering error, in
  this plugin's code path.
- Anything that makes the viewer read or transmit local files or user data.
- A cross-site scripting path through PDF metadata that the plugin renders.
- Memory exhaustion that hangs the page without user interaction.

Out of scope, because they belong upstream:

- Rendering bugs inside PDF.js itself. Report those to
  <https://github.com/mozilla/pdf.js> and tell us if we need to bump the version.
- A malformed PDF that renders incorrectly but does not execute anything.
- Denial of service from simply opening a very large or very complex file. That
  is a known limit of rasterising pages in a browser, and the page cache is
  bounded to keep it from growing without limit.

## Supported versions

The latest published minor version. This is a 0.x project, so fixes land on
`main` and a new version is published rather than backported.
