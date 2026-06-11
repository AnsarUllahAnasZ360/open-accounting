/** Tab group — muted pill list (default) or underline (line). Compose with TabsList/TabsTrigger/TabsContent. */
export interface TabsProps {
  /** initially active tab value (uncontrolled) */
  defaultValue?: string;
  /** controlled active value */
  value?: string;
  onValueChange?: (value: string) => void;
  children?: React.ReactNode;
  className?: string;
}
