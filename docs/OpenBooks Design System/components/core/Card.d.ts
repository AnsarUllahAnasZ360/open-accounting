/** Surface container — 14px radius, hairline ring, quiet shadow. Compose with CardHeader/CardTitle/CardDescription/CardAction/CardContent/CardFooter. */
export interface CardProps {
  /** @default "default" */
  size?: "default" | "sm";
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
