import * as React from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={className ? `card glass-dark ${className}` : `card glass-dark`}
      {...props}
    >
      {children}
    </div>
  )
}