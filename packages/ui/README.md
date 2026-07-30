# @selkie/ui

The shared component library and design system. Every surface (the web app, and the bot's web views) builds from these, so the product looks and behaves the same everywhere and a design change lands in one place.

## What's here

- `src/styles/theme.css` — design tokens (color, radius, spacing) and base component styles.
- `src/components/` — reusable primitives: `Button`, `Card`, `Money`.

## Migration plan

The web app (`apps/web`) still carries its own components and styles from the Canton build. As we build on Stellar, we promote the genuinely reusable ones (the money display, transaction rows, the reveal/scene motion, layout) into this package and have the web app import them from `@selkie/ui`. New shared pieces start here from day one.

## Rule

Components here know nothing about chains. They take plain props (a `Money` value, a label, a click handler). Anything chain-specific stays in an adapter and is passed in as data.
