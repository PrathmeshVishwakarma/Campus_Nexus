import * as React from 'react'

export interface BadgeProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
}

export function Badge({ className, ...props }: BadgeProps) {
  return (
    <button
      className={className ? `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}` : `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
      {...props}
    />
  )
}