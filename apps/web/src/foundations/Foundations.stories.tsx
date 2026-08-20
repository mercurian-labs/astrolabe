import type { Meta, StoryObj } from "@storybook/react";

import type { ThemeAppearance } from "../themePalette";
import { foundationsRoles, foundationsThemes } from "./foundations.logic";

const TYPE_VOICES = [
  {
    token: "--font-sans",
    sample: "Interface labels, navigation, and everyday controls",
  },
  {
    token: "--font-mono",
    sample: "Code, identifiers, paths, and precise values",
  },
] as const;

const meta = {
  title: "Foundations",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticRoles: Story = {
  name: "Semantic roles",
  render: (_, context) => {
    const themes = foundationsThemes();
    const theme = themes.find(({ id }) => id === context.globals.theme) ?? themes[0]!;
    const appearance: ThemeAppearance = context.globals.appearance === "dark" ? "dark" : "light";
    const roles = foundationsRoles(theme, appearance);

    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-10">
          <header className="space-y-2">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Foundations
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Semantic roles</h1>
            <p className="text-sm text-muted-foreground">
              {theme.label} · {appearance}
            </p>
          </header>

          <section aria-labelledby="semantic-colors-heading" className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold" id="semantic-colors-heading">
                Color roles
              </h2>
              <p className="text-sm text-muted-foreground">
                Declared palette values beside the live variables applied to this canvas.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-3xl border-collapse text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Role
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      CSS variable
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Declared value
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Live swatch
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {roles.map(({ role, cssVariable, value }) => (
                    <tr className="bg-card" key={role}>
                      <th className="px-4 py-3 font-medium" scope="row">
                        {role}
                      </th>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {cssVariable}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{value}</td>
                      <td className="px-4 py-3">
                        <span
                          aria-label={`${role} live color`}
                          className="block h-8 w-20 rounded-md border border-border"
                          style={{ background: `var(${cssVariable}, ${value})` }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="type-voices-heading" className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold" id="type-voices-heading">
                Type voices
              </h2>
              <p className="text-sm text-muted-foreground">
                The two inherited font tokens used throughout the product.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {TYPE_VOICES.map(({ token, sample }) => (
                <article
                  className="space-y-4 rounded-xl border border-border bg-card p-5"
                  key={token}
                >
                  <code className="font-mono text-xs text-muted-foreground">{token}</code>
                  <p className="text-xl leading-relaxed" style={{ fontFamily: `var(${token})` }}>
                    {sample}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  },
};
