import { expect, it } from "@effect/vitest";

import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import { ChangeGroupToolkit } from "./tools.ts";

it("tells the agent what each change group parameter is", () => {
  const described = Object.fromEntries(
    Object.entries(ChangeGroupToolkit.tools).map(([name, tool]) => {
      const schema = advertisedJsonSchema(tool) as {
        properties: Record<string, { description?: string }>;
      };
      return [
        name,
        Object.fromEntries(
          Object.entries(schema.properties).map(([key, property]) => [
            key,
            Boolean(property.description),
          ]),
        ),
      ];
    }),
  );
  expect(described).toEqual({
    astrolabe_change_groups: { groupId: true, memberKeys: true },
    astrolabe_change_group_suggest: { groupId: true, memberKey: true, note: true },
    astrolabe_change_group_update: { groupId: true, action: true, memberKey: true, note: true },
  });
});
