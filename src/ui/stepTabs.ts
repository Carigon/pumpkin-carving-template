import type { Step, StepId } from "../steps";

export interface StepTabs {
  /**
   * Show `list` as the tabs, with `current` selected and its panel showing. Tabs of the steps marked `warned`
   * carry a warning badge, announced as e.g. "Design, has warnings".
   */
  render(list: readonly Step[], current: StepId): void;
}

/**
 * The step tabs at the top of the controls pane (the ARIA tabs pattern: arrow keys move between tabs,
 * Home/End jump to the ends) and Back/Next at the bottom of each step panel. Steps are free: any tab can be
 * opened at any time. Renders only what the step model returns; `onSelect` is called with the step the
 * carver picked, and the caller re-renders.
 *
 * `panels` maps each step to its tabpanel element, which must have an id. Two steps may share one panel
 * (Design and Grid never appear together).
 */
export function mountStepTabs(
  tablist: HTMLElement,
  panels: Record<StepId, HTMLElement>,
  onSelect: (step: StepId) => void,
): StepTabs {
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Steps");
  tablist.classList.add("step-tabs");

  let list: readonly Step[] = [];
  let current: StepId = "measure";

  const tabId = (id: StepId) => `step-tab-${id}`;

  // Each panel gets one Back/Next bar, filled in on render.
  const navs = new Map<HTMLElement, HTMLElement>();
  for (const panel of new Set(Object.values(panels))) {
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = -1;
    const nav = document.createElement("nav");
    nav.className = "step-nav";
    nav.setAttribute("aria-label", "Step navigation");
    panel.append(nav);
    navs.set(panel, nav);
  }

  const move = (offset: number, focus: boolean) => {
    const i = list.findIndex((s) => s.id === current);
    const next = list[(i + offset + list.length) % list.length];
    onSelect(next.id);
    if (focus) tablist.querySelector<HTMLElement>(`#${tabId(next.id)}`)?.focus();
  };

  tablist.addEventListener("keydown", (e) => {
    const i = list.findIndex((s) => s.id === current);
    const target = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    move(target - i, true);
  });

  return {
    render(nextList, nextCurrent) {
      list = nextList;
      current = nextCurrent;
      // Re-rendering (e.g. when the warnings change) mustn't drop the keyboard focus on a tab.
      const focused = tablist.contains(document.activeElement) ? document.activeElement?.id : undefined;
      tablist.replaceChildren(
        ...list.map((step) => {
          const tab = document.createElement("button");
          tab.type = "button";
          tab.id = tabId(step.id);
          tab.className = "step-tab";
          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-controls", panels[step.id].id);
          const selected = step.id === current;
          tab.setAttribute("aria-selected", String(selected));
          tab.tabIndex = selected ? 0 : -1;
          tab.textContent = step.title;
          if (step.warned) {
            const dot = document.createElement("span");
            dot.className = "step-badge";
            dot.setAttribute("aria-hidden", "true");
            const text = document.createElement("span");
            text.className = "visually-hidden";
            text.textContent = ", has warnings";
            tab.append(dot, text);
            tab.title = `${step.title} has warnings`;
          }
          tab.addEventListener("click", () => onSelect(step.id));
          return tab;
        }),
      );
      if (focused) tablist.querySelector<HTMLElement>(`#${focused}`)?.focus();

      const shown = panels[current];
      for (const panel of navs.keys()) panel.hidden = panel !== shown;
      shown.setAttribute("aria-labelledby", tabId(current));

      const i = list.findIndex((s) => s.id === current);
      const nav = navs.get(shown)!;
      const button = (label: string, offset: number, cls: string) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = label;
        b.addEventListener("click", () => {
          move(offset, false);
          panels[list[i + offset].id].focus({ preventScroll: true });
        });
        return b;
      };
      nav.replaceChildren(
        ...(i > 0 ? [button(`← ${list[i - 1].title}`, -1, "step-back")] : []),
        ...(i < list.length - 1 ? [button(`${list[i + 1].title} →`, 1, "step-next")] : []),
      );
    },
  };
}
