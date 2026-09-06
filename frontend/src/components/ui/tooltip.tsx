import * as React from 'react'

export interface TooltipProps {
  children: React.ReactNode
  className?: string
}

export function Tooltip({ children, className, ...props }: TooltipProps) {
  return (
    <div
      className={className ? `relative inline-block ${className}` : `relative inline-block`}
      {...props}
    >
      {children}
      <span className="absolute right-0 top-full mt-1 bg-[var(--card)] px-2 py-1 text-xs rounded border border-[var(--border)] hidden opacity-0 group-hover:opacity-100 group-hover:visible transition-opacity">
        {children}
      </span>
    </div>
  )
}