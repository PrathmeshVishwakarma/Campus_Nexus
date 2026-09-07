import * as React from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_2px_12px_rgba(0,0,0,0.2)] backdrop-blur-xl p-5 ${className ?? ''}`}
      {...props}
    >
      {children}
    </div>
  )
}
