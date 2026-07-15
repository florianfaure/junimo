import { Text } from "@astryxdesign/core/Text";
import type { TextProps } from "@astryxdesign/core/Text";

/**
 * `Num` — données chiffrées en police mono du DS (tâche #26 : « mono pour les
 * données chiffrées »). Enveloppe `Text` en forçant `--font-family-code` et les
 * chiffres tabulaires (colonnes alignées, pas de saut de largeur quand un
 * compte à rebours défile). Le `type` par défaut (`supporting`) reste
 * surchargeable, comme la couleur/taille.
 */
export function Num({ type = "supporting", style, ...rest }: TextProps) {
  return (
    <Text
      type={type}
      style={{
        fontFamily: "var(--font-family-code)",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
      {...rest}
    />
  );
}
