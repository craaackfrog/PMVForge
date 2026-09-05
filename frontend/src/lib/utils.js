import { clsx } from 'clsx'

/**
 * Simple className merger (shadcn-style)
 */
export function cn(...inputs) {
  return clsx(inputs)
}
