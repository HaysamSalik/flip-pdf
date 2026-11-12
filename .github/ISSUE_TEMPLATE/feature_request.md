---
name: Feature request
about: Suggest a capability the viewer does not have
title: ""
labels: enhancement
assignees: ""
---

## The problem

<!-- What are you trying to do that you cannot do today? Describe the use case,
not the API you have in mind. -->

## What you would like

<!-- The behaviour you want. If it changes the page turn, say what the paper
should look like. -->

## Have you checked it is not already an option?

The options are in the README table. `curl`, `bias`, `fit`, `mode`,
`duration`, `springOmega`, `easing`, `dragDistance` and `wheel` cover most
visual requests.

## Scope check

This library deliberately does one thing: turn a PDF into a page-turning book.
The following are out of scope, and asking for them will most likely get a
"no", not because the idea is bad but because they belong in a different tool:

- Text selection or search. Pages are rasterised.
- Annotation, form filling, or live links inside the PDF.
- Server-side rendering or PDF generation.
- A second runtime dependency for animation.

If your request is one of those, it is still worth opening an issue to say why,
but expect a closed one.
