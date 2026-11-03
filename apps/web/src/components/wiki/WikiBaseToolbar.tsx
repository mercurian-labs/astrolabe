import type {
  WikiBaseEdit,
  WikiBaseFilter,
  WikiBaseViewSettingsEdit,
  WikiBaseViewType,
  WikiQueryResult,
} from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  FilterIcon,
  Columns3Icon,
  GroupIcon,
  ArrowUpDownIcon,
  PlusIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { orderId } from "@t3tools/client-runtime/wikiBaseEdits";

const VIEW_TYPES: ReadonlyArray<{
  readonly type: WikiBaseViewType;
  readonly label: string;
}> = [
  { type: "table", label: "Table" },
  { type: "cards", label: "Cards" },
  { type: "list", label: "List" },
  { type: "kanban", label: "Board" },
  { type: "map", label: "Map" },
];

const SUMMARY_NAMES = [
  "Average",
  "Min",
  "Max",
  "Sum",
  "Range",
  "Median",
  "Stddev",
  "Earliest",
  "Latest",
  "Checked",
  "Unchecked",
  "Empty",
  "Filled",
  "Unique",
] as const;

const NONE = "__none__";

type Property = { readonly id: string; readonly label: string };

/** Asks for a name. A dialog, since a menu closing takes focus back from any field beside it. */
function NameDialog({
  title,
  label,
  initial,
  onClose,
  onSave,
}: {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly onClose: () => void;
  readonly onSave: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(name.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** One property from the base's, or none. */
function PropertySelect({
  id,
  value,
  properties,
  onChange,
  none,
}: {
  readonly id?: string;
  readonly value: string | undefined;
  readonly properties: ReadonlyArray<Property>;
  readonly onChange: (value: string | null) => void;
  readonly none?: string;
}) {
  const known = properties.some(
    (property) => property.id === value || orderId(property.id) === value,
  );
  const listed =
    value === undefined || known ? properties : [...properties, { id: value, label: value }];
  const selected =
    value === undefined
      ? NONE
      : (listed.find((property) => property.id === value || orderId(property.id) === value)?.id ??
        value);
  return (
    <Select
      value={selected}
      items={{
        ...(none === undefined ? {} : { [NONE]: none }),
        ...Object.fromEntries(listed.map((property) => [property.id, property.label])),
      }}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next === NONE ? null : next);
      }}
    >
      <SelectTrigger id={id} size="compact">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {none === undefined ? null : <SelectItem value={NONE}>{none}</SelectItem>}
        {listed.map((property) => (
          <SelectItem key={property.id} value={property.id}>
            {property.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div id={id}>{children}</div>
    </div>
  );
}

/** A text or number setting, applied when it loses focus or on Enter. */
function SettingInput({
  value,
  numeric = false,
  placeholder,
  onCommit,
}: {
  readonly value: string | number | undefined;
  readonly numeric?: boolean;
  readonly placeholder?: string;
  readonly onCommit: (value: string | number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    if (!text) return onCommit(null);
    if (!numeric) return onCommit(text);
    const number = Number(text);
    if (Number.isFinite(number)) onCommit(number);
  };
  return (
    <Input
      size="compact"
      value={shown}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function ToolbarPopover({
  icon,
  label,
  count,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost-muted" size="compact" />}>
        {icon}
        {label}
        {count ? <span className="text-foreground">{count}</span> : null}
      </PopoverTrigger>
      <PopoverPopup align="start" width="md" padding="compact">
        <div className="flex flex-col gap-3">{children}</div>
      </PopoverPopup>
    </Popover>
  );
}

/** A view's statements, when they are a flat list under one `and` or `or`; else null. */
function flatFilters(
  filters: WikiBaseFilter | undefined,
): { readonly mode: "and" | "or"; readonly items: ReadonlyArray<string> } | null {
  if (filters === undefined) return { mode: "and", items: [] };
  if (typeof filters === "string") return { mode: "and", items: [filters] };
  if ("and" in filters && filters.and.every((item) => typeof item === "string")) {
    return { mode: "and", items: filters.and as ReadonlyArray<string> };
  }
  if ("or" in filters && filters.or.every((item) => typeof item === "string")) {
    return { mode: "or", items: filters.or as ReadonlyArray<string> };
  }
  return null;
}

function FilterEditor({
  filters,
  onChange,
}: {
  readonly filters: WikiBaseFilter | undefined;
  readonly onChange: (filters: WikiBaseFilter | null) => void;
}) {
  const flat = flatFilters(filters);
  const [adding, setAdding] = useState("");
  if (flat === null) {
    return (
      <p className="text-muted-foreground text-xs">
        This view's filters nest groups inside groups. Edit them in the base's YAML.
      </p>
    );
  }
  const write = (mode: "and" | "or", items: ReadonlyArray<string>) =>
    onChange(items.length === 0 ? null : mode === "and" ? { and: [...items] } : { or: [...items] });
  return (
    <>
      <Select
        value={flat.mode}
        items={{ and: "All of these", or: "Any of these" }}
        onValueChange={(mode) => {
          if (mode === "and" || mode === "or") write(mode, flat.items);
        }}
      >
        <SelectTrigger size="compact">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="and">All of these</SelectItem>
          <SelectItem value="or">Any of these</SelectItem>
        </SelectPopup>
      </Select>
      {flat.items.map((item, position) => (
        // oxlint-disable-next-line react/no-array-index-key -- statements can repeat
        <div key={position} className="flex items-center gap-1">
          <SettingInput
            value={item}
            onCommit={(next) =>
              write(
                flat.mode,
                next === null
                  ? flat.items.filter((_, at) => at !== position)
                  : flat.items.map((entry, at) => (at === position ? String(next) : entry)),
              )
            }
          />
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Remove filter"
            onClick={() =>
              write(
                flat.mode,
                flat.items.filter((_, at) => at !== position),
              )
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!adding.trim()) return;
          write(flat.mode, [...flat.items, adding.trim()]);
          setAdding("");
        }}
      >
        <Input
          size="compact"
          value={adding}
          placeholder='status == "open"'
          onChange={(event) => setAdding(event.target.value)}
        />
        <Button type="submit" variant="ghost-muted" size="icon-xs" aria-label="Add filter">
          <PlusIcon />
        </Button>
      </form>
    </>
  );
}

function SortEditor({
  result,
  properties,
  onChange,
}: {
  readonly result: WikiQueryResult;
  readonly properties: ReadonlyArray<Property>;
  readonly onChange: (sort: WikiBaseViewSettingsEdit["sort"]) => void;
}) {
  const sort = result.settings?.sort ?? [];
  const write = (next: typeof sort) => onChange(next.length ? next : null);
  return (
    <>
      {sort.map((entry, position) => (
        <div key={entry.property} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <PropertySelect
              value={entry.property}
              properties={properties}
              onChange={(property) =>
                write(
                  property === null
                    ? sort.filter((_, at) => at !== position)
                    : sort.map((item, at) =>
                        at === position ? { ...item, property: orderId(property) } : item,
                      ),
                )
              }
            />
          </div>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={entry.direction === "ASC" ? "Ascending" : "Descending"}
            onClick={() =>
              write(
                sort.map((item, at) =>
                  at === position
                    ? { ...item, direction: item.direction === "ASC" ? "DESC" : "ASC" }
                    : item,
                ),
              )
            }
          >
            {entry.direction === "ASC" ? <ArrowUpIcon /> : <ArrowDownIcon />}
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Remove sort"
            onClick={() => write(sort.filter((_, at) => at !== position))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <PropertySelect
        value={undefined}
        none="Add a sort…"
        properties={properties.filter(
          (property) => !sort.some((entry) => orderId(entry.property) === orderId(property.id)),
        )}
        onChange={(property) => {
          if (property !== null)
            write([...sort, { property: orderId(property), direction: "ASC" }]);
        }}
      />
    </>
  );
}

function PropertiesEditor({
  result,
  onSettings,
  onEdit,
  file,
}: {
  readonly result: WikiQueryResult;
  readonly onSettings: (settings: WikiBaseViewSettingsEdit) => void;
  readonly onEdit: (edit: WikiBaseEdit) => void;
  readonly file: string;
}) {
  const order = result.settings?.order ?? result.columns.map((column) => column.id);
  const all = result.properties ?? [];
  const shown = (id: string) => order.findIndex((entry) => orderId(entry) === orderId(id));
  const setOrder = (next: ReadonlyArray<string>) => onSettings({ order: [...next] });
  const [formula, setFormula] = useState({ name: "", expression: "" });
  const sorted = [
    ...order.map(
      (entry) =>
        all.find((property) => orderId(property.id) === orderId(entry)) ?? {
          id: entry,
          label: entry,
        },
    ),
    ...all.filter((property) => shown(property.id) < 0),
  ];
  return (
    <>
      <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {sorted.map((property) => {
          const position = shown(property.id);
          return (
            <div key={property.id} className="flex items-center gap-2 text-sm">
              <Switch
                size="sm"
                checked={position >= 0}
                aria-label={`Show ${property.label}`}
                onCheckedChange={(checked) =>
                  setOrder(
                    checked
                      ? [...order, orderId(property.id)]
                      : order.filter((entry) => orderId(entry) !== orderId(property.id)),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">{property.label}</span>
              {position >= 0 ? (
                <>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Move ${property.label} up`}
                    disabled={position === 0}
                    onClick={() =>
                      setOrder(
                        order.toSpliced(position, 1).toSpliced(position - 1, 0, order[position]!),
                      )
                    }
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Move ${property.label} down`}
                    disabled={position === order.length - 1}
                    onClick={() =>
                      setOrder(
                        order.toSpliced(position, 1).toSpliced(position + 1, 0, order[position]!),
                      )
                    }
                  >
                    <ArrowDownIcon />
                  </Button>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <form
        className="flex flex-col gap-1.5 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name = formula.name.trim();
          if (!name || !formula.expression.trim()) return;
          onEdit({ kind: "formula", base: file, name, expression: formula.expression.trim() });
          setOrder([...order, `formula.${name}`]);
          setFormula({ name: "", expression: "" });
        }}
      >
        <span className="text-muted-foreground text-xs">Add a formula</span>
        <Input
          size="compact"
          placeholder="Name"
          value={formula.name}
          onChange={(event) => setFormula({ ...formula, name: event.target.value })}
        />
        <Input
          size="compact"
          placeholder="price * quantity"
          value={formula.expression}
          onChange={(event) => setFormula({ ...formula, expression: event.target.value })}
        />
        <Button type="submit" variant="outline" size="compact">
          Add formula
        </Button>
      </form>
    </>
  );
}

function LayoutSettings({
  result,
  properties,
  onSettings,
}: {
  readonly result: WikiQueryResult;
  readonly properties: ReadonlyArray<Property>;
  readonly onSettings: (settings: WikiBaseViewSettingsEdit) => void;
}) {
  const settings = result.settings ?? {};
  const choice = (
    label: string,
    value: string | undefined,
    options: Readonly<Record<string, string>>,
    write: (value: string) => void,
  ) => (
    <Field label={label}>
      <Select
        value={value ?? Object.keys(options)[0]}
        items={options}
        onValueChange={(next) => {
          if (typeof next === "string") write(next);
        }}
      >
        <SelectTrigger size="compact">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
  const property = (
    label: string,
    value: string | undefined,
    write: (value: string | null) => void,
  ) => (
    <Field label={label}>
      <PropertySelect value={value} properties={properties} none="None" onChange={write} />
    </Field>
  );
  const number = (
    label: string,
    value: number | undefined,
    write: (value: number | null) => void,
  ) => (
    <Field label={label}>
      <SettingInput
        value={value}
        numeric
        onCommit={(next) => write(typeof next === "number" ? next : null)}
      />
    </Field>
  );
  const text = (
    label: string,
    value: string | undefined,
    write: (value: string | null) => void,
    placeholder?: string,
  ) => (
    <Field label={label}>
      <SettingInput
        value={value}
        {...(placeholder === undefined ? {} : { placeholder })}
        onCommit={(next) => write(next === null ? null : String(next))}
      />
    </Field>
  );
  const type = result.view.type;
  return (
    <>
      {type === "table"
        ? choice(
            "Row height",
            settings.rowHeight ?? "medium",
            { short: "Short", medium: "Medium", tall: "Tall", "extra-tall": "Extra tall" },
            (rowHeight) => onSettings({ rowHeight }),
          )
        : null}
      {type === "cards" ? (
        <>
          {number("Card size", settings.cardSize, (cardSize) => onSettings({ cardSize }))}
          {property("Image property", settings.image, (image) => onSettings({ image }))}
          {choice(
            "Image fit",
            settings.imageFit ?? "cover",
            { cover: "Cover", contain: "Contain" },
            (imageFit) => onSettings({ imageFit }),
          )}
          {number("Image aspect ratio", settings.imageAspectRatio, (imageAspectRatio) =>
            onSettings({ imageAspectRatio }),
          )}
        </>
      ) : null}
      {type === "list" ? (
        <>
          {choice(
            "Markers",
            settings.markers ?? "bullet",
            { bullet: "Bullets", number: "Numbers", none: "None" },
            (markers) => onSettings({ markers }),
          )}
          <div className="flex items-center gap-2 text-sm">
            <Switch
              size="sm"
              checked={settings.indentProperties === true}
              aria-label="Indent properties"
              onCheckedChange={(indentProperties) => onSettings({ indentProperties })}
            />
            Indent properties
          </div>
          {settings.indentProperties
            ? null
            : text("Separator", settings.separator, (separator) => onSettings({ separator }), ", ")}
        </>
      ) : null}
      {type === "map" ? (
        <>
          {property("Marker coordinates", settings.coordinates, (coordinates) =>
            onSettings({ coordinates }),
          )}
          {property("Marker icon", settings.markerIcon, (markerIcon) => onSettings({ markerIcon }))}
          {property("Marker color", settings.markerColor, (markerColor) =>
            onSettings({ markerColor }),
          )}
          {number("Embedded height", settings.mapHeight, (mapHeight) => onSettings({ mapHeight }))}
          {text(
            "Center coordinates",
            settings.center,
            (center) => onSettings({ center }),
            "48.8584, 2.2945",
          )}
          {number("Default zoom", settings.defaultZoom, (defaultZoom) =>
            onSettings({ defaultZoom }),
          )}
          {text(
            "Map tiles",
            settings.mapTiles?.[0],
            (tiles) => onSettings({ mapTiles: tiles === null ? null : [tiles] }),
            "https://tiles.openfreemap.org/styles/liberty",
          )}
        </>
      ) : null}
      {number("Limit", settings.limit, (limit) => onSettings({ limit }))}
    </>
  );
}

/**
 * A view's controls, as Obsidian's toolbar has them: which view, how it sorts, filters, groups
 * and lays out, which properties it shows, and New. Each change is an edit the page holds until
 * it's saved to a change request.
 */
export function WikiBaseToolbar({
  result,
  file,
  onPickView,
  onEdit,
  onNew,
}: {
  readonly result: WikiQueryResult;
  readonly file: string;
  readonly onPickView: (view: string) => void;
  readonly onEdit: (edit: WikiBaseEdit) => void;
  readonly onNew: () => void;
}) {
  const view = result.view.name;
  const onSettings = (settings: WikiBaseViewSettingsEdit) =>
    onEdit({ kind: "view", base: file, view, settings });
  const properties = result.properties ?? result.columns;
  const settings = result.settings ?? {};
  const [renaming, setRenaming] = useState(false);
  const filterCount = (() => {
    const flat = flatFilters(settings.filters);
    return flat === null ? 1 : flat.items.length;
  })();
  const nextName = (type: WikiBaseViewType) => {
    const label = VIEW_TYPES.find((entry) => entry.type === type)?.label ?? "View";
    let name = label;
    for (let count = 2; result.views.includes(name); count += 1) name = `${label} ${count}`;
    return name;
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Menu>
        <MenuTrigger render={<Button variant="outline" size="compact" />}>
          {view}
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={view}
            onValueChange={(next) => {
              if (typeof next === "string") onPickView(next);
            }}
          >
            {result.views.map((name) => (
              <MenuRadioItem key={name} value={name} closeOnClick>
                {name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuSub>
            <MenuSubTrigger>Layout</MenuSubTrigger>
            <MenuSubPopup>
              <MenuRadioGroup
                value={result.view.type}
                onValueChange={(type) => {
                  if (typeof type === "string") onEdit({ kind: "view", base: file, view, type });
                }}
              >
                {VIEW_TYPES.map((entry) => (
                  <MenuRadioItem key={entry.type} value={entry.type} closeOnClick>
                    {entry.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
          <MenuSub>
            <MenuSubTrigger>Add view</MenuSubTrigger>
            <MenuSubPopup>
              {VIEW_TYPES.map((entry) => (
                <MenuItem
                  key={entry.type}
                  onClick={() => {
                    const name = nextName(entry.type);
                    onEdit({ kind: "add-view", base: file, name, type: entry.type });
                    onPickView(name);
                  }}
                >
                  {entry.label}
                </MenuItem>
              ))}
            </MenuSubPopup>
          </MenuSub>
          <MenuItem onClick={() => setRenaming(true)}>Rename view</MenuItem>
          <MenuItem
            onClick={() => {
              let name = `${view} copy`;
              for (let count = 2; result.views.includes(name); count += 1) {
                name = `${view} copy ${count}`;
              }
              onEdit({ kind: "add-view", base: file, name, type: result.view.type, copy: view });
              onPickView(name);
            }}
          >
            Duplicate view
          </MenuItem>
          <MenuItem
            disabled={result.views.length < 2}
            onClick={() => {
              onEdit({ kind: "remove-view", base: file, view });
              onPickView(result.views.find((name) => name !== view) ?? view);
            }}
          >
            Delete view
          </MenuItem>
        </MenuPopup>
      </Menu>
      {renaming ? (
        <NameDialog
          title="Rename view"
          label="View name"
          initial={view}
          onClose={() => setRenaming(false)}
          onSave={(name) => {
            setRenaming(false);
            if (!name || name === view) return;
            onEdit({ kind: "view", base: file, view, name });
            onPickView(name);
          }}
        />
      ) : null}
      <span className="px-1 text-muted-foreground text-xs">
        {result.total === 1 ? "1 result" : `${result.total} results`}
      </span>
      <div className="ms-auto flex flex-wrap items-center gap-1">
        <ToolbarPopover icon={<ArrowUpDownIcon />} label="Sort" count={settings.sort?.length ?? 0}>
          <SortEditor
            result={result}
            properties={properties}
            onChange={(sort) => onSettings({ sort })}
          />
        </ToolbarPopover>
        <ToolbarPopover icon={<FilterIcon />} label="Filter" count={filterCount}>
          <FilterEditor
            filters={settings.filters}
            onChange={(filters) => onSettings({ filters })}
          />
        </ToolbarPopover>
        <ToolbarPopover icon={<GroupIcon />} label="Group" count={settings.groupBy ? 1 : 0}>
          <Field label="Group by">
            <PropertySelect
              value={settings.groupBy?.property}
              properties={properties}
              none="None"
              onChange={(property) =>
                onSettings({
                  groupBy:
                    property === null
                      ? null
                      : {
                          property: orderId(property),
                          direction: settings.groupBy?.direction ?? "ASC",
                        },
                  groupOrder: null,
                })
              }
            />
          </Field>
          {settings.groupBy ? (
            <Button
              variant="ghost-muted"
              size="compact"
              onClick={() =>
                onSettings({
                  groupBy: {
                    ...settings.groupBy!,
                    direction: settings.groupBy!.direction === "ASC" ? "DESC" : "ASC",
                  },
                })
              }
            >
              {settings.groupBy.direction === "ASC" ? <ArrowUpIcon /> : <ArrowDownIcon />}
              {settings.groupBy.direction === "ASC" ? "Ascending" : "Descending"}
            </Button>
          ) : null}
        </ToolbarPopover>
        <ToolbarPopover icon={<Columns3Icon />} label="Properties">
          <PropertiesEditor result={result} onSettings={onSettings} onEdit={onEdit} file={file} />
        </ToolbarPopover>
        <ToolbarPopover icon={<Settings2Icon />} label="Layout">
          <LayoutSettings result={result} properties={properties} onSettings={onSettings} />
        </ToolbarPopover>
        <Button variant="outline" size="compact" onClick={onNew}>
          <PlusIcon />
          New
        </Button>
      </div>
    </div>
  );
}

/** A table column's heading as a menu: sort by it, summarize it, rename or hide it. */
export function ColumnMenu({
  column,
  label,
  result,
  file,
  onEdit,
}: {
  readonly column: { readonly id: string; readonly label: string };
  readonly label: ReactNode;
  readonly result: WikiQueryResult;
  readonly file: string;
  readonly onEdit: (edit: WikiBaseEdit) => void;
}) {
  const view = result.view.name;
  const settings = result.settings ?? {};
  const onSettings = (next: WikiBaseViewSettingsEdit) =>
    onEdit({ kind: "view", base: file, view, settings: next });
  const summary = settings.summaries?.[column.id];
  const sortBy = (direction: "ASC" | "DESC") =>
    onSettings({
      sort: [
        { property: column.id, direction },
        ...(settings.sort ?? []).filter((entry) => orderId(entry.property) !== orderId(column.id)),
      ],
    });
  const [renaming, setRenaming] = useState(false);
  const canonical = column.id.includes(".") ? column.id : `note.${column.id}`;
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<button type="button" className="cursor-pointer text-left font-medium" />}
        >
          {label}
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem onClick={() => sortBy("ASC")}>
            <ArrowUpIcon />
            Sort ascending
          </MenuItem>
          <MenuItem onClick={() => sortBy("DESC")}>
            <ArrowDownIcon />
            Sort descending
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger>Summarize</MenuSubTrigger>
            <MenuSubPopup>
              <MenuRadioGroup
                value={summary ?? NONE}
                onValueChange={(name) => {
                  if (typeof name !== "string") return;
                  const rest = Object.fromEntries(
                    Object.entries(settings.summaries ?? {}).filter(([id]) => id !== column.id),
                  );
                  const next = name === NONE ? rest : { ...rest, [column.id]: name };
                  onSettings({ summaries: Object.keys(next).length ? next : null });
                }}
              >
                <MenuRadioItem value={NONE} closeOnClick>
                  None
                </MenuRadioItem>
                {SUMMARY_NAMES.map((name) => (
                  <MenuRadioItem key={name} value={name} closeOnClick>
                    {name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
          <MenuSeparator />
          <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
          <MenuItem
            onClick={() =>
              onSettings({
                order: (settings.order ?? result.columns.map((entry) => entry.id)).filter(
                  (entry) => orderId(entry) !== orderId(column.id),
                ),
              })
            }
          >
            Hide
          </MenuItem>
        </MenuPopup>
      </Menu>
      {renaming ? (
        <NameDialog
          title="Rename column"
          label="Column name"
          initial={column.label}
          onClose={() => setRenaming(false)}
          onSave={(name) => {
            setRenaming(false);
            onEdit({
              kind: "display-name",
              base: file,
              property: canonical,
              displayName: name || null,
            });
          }}
        />
      ) : null}
    </>
  );
}
