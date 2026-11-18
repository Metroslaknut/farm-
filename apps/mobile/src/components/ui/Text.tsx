import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { theme } from '@/theme';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption';

const STYLES = {
  title: { fontSize: theme.font.size.xxl, fontWeight: theme.font.weight.bold, lineHeight: 34 },
  heading: { fontSize: theme.font.size.xl, fontWeight: theme.font.weight.bold, lineHeight: 28 },
  body: { fontSize: theme.font.size.md, fontWeight: theme.font.weight.regular, lineHeight: 24 },
  label: { fontSize: theme.font.size.sm, fontWeight: theme.font.weight.medium, lineHeight: 20 },
  caption: { fontSize: theme.font.size.xs, fontWeight: theme.font.weight.regular, lineHeight: 16 },
} as const;

export interface TextProps extends RNTextProps {
  variant?: Variant;
  muted?: boolean;
  color?: string;
}

/** The only text component: always themed, always scales with the user's font-size setting. */
export function Text({ variant = 'body', muted, color, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      accessibilityRole={
        variant === 'title' || variant === 'heading' ? 'header' : rest.accessibilityRole
      }
      style={[
        STYLES[variant],
        { color: color ?? (muted ? theme.colors.textMuted : theme.colors.text) },
        style,
      ]}
    />
  );
}
