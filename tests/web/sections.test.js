import { describe, expect, it } from "vitest";
import { minutesSections, replaceSection } from "../../src/web/lib/sections";

const MINUTES = "# Minuta: Junta\n\n## Datos\n- Fecha: hoy\n\n## Acuerdos\n- Uno\n\n### Detalle\nTexto\n\n## Pendientes\n- Dos\n";

describe("minutes sections", () => {
  it("split at the main headings, keeping sub-headings inside, and cover the whole text", () => {
    const parts = minutesSections(MINUTES);
    expect(parts.map((p) => p.text.split("\n")[0])).toEqual(["# Minuta: Junta", "## Datos", "## Acuerdos", "## Pendientes"]);
    expect(parts[2].text).toContain("### Detalle");
    expect(parts.map((p) => p.text).join("")).toBe(MINUTES);
  });

  it("use the level that repeats, and keep text before the first heading", () => {
    const parts = minutesSections("Intro\n\n### Uno\na\n### Dos\nb");
    expect(parts.map((p) => p.text)).toEqual(["Intro\n\n", "### Uno\na\n", "### Dos\nb"]);
    expect(minutesSections("Solo texto, sin títulos.")).toHaveLength(1);
    expect(minutesSections("")).toEqual([]);
  });

  it("replace one part and keep the spacing, or remove it", () => {
    const parts = minutesSections(MINUTES);
    const next = replaceSection(MINUTES, parts[2], "## Acuerdos\n- Uno\n- Tres");
    expect(next).toBe("# Minuta: Junta\n\n## Datos\n- Fecha: hoy\n\n## Acuerdos\n- Uno\n- Tres\n\n## Pendientes\n- Dos\n");
    expect(replaceSection(MINUTES, parts[1], "  ")).toBe("# Minuta: Junta\n\n## Acuerdos\n- Uno\n\n### Detalle\nTexto\n\n## Pendientes\n- Dos\n");
  });
});
