# Goal

As an Astrolabe contributor, I need a complete, browsable map of the product's current visual system so that I can build consistently today and later introduce Astrolabe's unique identity without rediscovering or rewriting component behavior.

Astrolabe currently inherits T3 Code's visual language. This first design-system pass captures what the product already ships across foundations, reusable controls, and Mercurian-specific states; it does not redesign the brand or define a mobile visual system.

# AC

- [ ] A contributor can open the design-system showcase from the ordinary web or desktop development app without connecting to a server or workspace.
- [ ] The showcase renders the same styles, themes, controls, and product components that Astrolabe itself ships, including the current light and dark appearances.
- [ ] The showcase visibly accounts for every current visual foundation, customizable color role, reusable web control, and Mercurian-specific component state; anything intentionally excluded is listed with a reason.
- [ ] Every state available in the current component catalog remains available in the new showcase with deterministic, synthetic data and no access to a real provider, repository, database, or user workspace.
- [ ] Contributors can inspect relevant narrow-width, increased-text, keyboard-focus, and reduced-motion behavior from the showcase where those conditions materially affect a component.
- [ ] Every showcase example is automatically checked for successful rendering and accessibility, and its defined interactions run through the same required test gate as the rest of the web client.
- [ ] Mapping the current system and moving to the new showcase does not intentionally change Astrolabe's shipped appearance or component behavior.
- [ ] Once parity is demonstrated, contributors have one in-app design-system workflow and no longer need a separate Storybook workflow to inspect or verify these states.
