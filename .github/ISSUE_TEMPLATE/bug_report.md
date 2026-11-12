---
name: Bug report
about: Something renders wrong, or the viewer misbehaves
title: ""
labels: bug
assignees: ""
---

## What happened

<!-- One or two sentences. What did the sheet or the chrome do? -->

## What you expected

<!-- If it is visual, describe the shape the paper should have taken. -->

## Steps to reproduce

1.
2.
3.

## Environment

| | |
| --- | --- |
| Browser and version | |
| Operating system | |
| Renderer (the viewer console: `document.querySelector('[data-flip-pdf]').flipbook.backend`) | `webgl` or `canvas2d` |
| `flip-pdf` version | |
| Page count and page size of the PDF | |
| Mode (double or single) | |

## If it is visual

A frame is worth more than a description. With the demo running:

```
npm start
node tools/frames.mjs 1 1280
```

Attach the frame that looks wrong from `/tmp/opencode/frames/` and say which
progress value it is.

## Console output

<!-- Any errors. If there are none, say so: "no console errors" is useful. -->

## The PDF

If the problem needs a specific document, say what kind of file it is (scanned,
image-heavy, mixed page sizes, encrypted). Please do not attach a file you do not
have the right to share.
