import * as React from 'react'

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Avatar({ className, children, ...props }: AvatarProps) {
  return (
    <div
      className={className ? `w-8 h-8 rounded-full flex items-center justify-center ${className}` : `w-8 h-8 rounded-full flex items-center justify-center`}
      {...props}
    >
      {children}
    </div>
  )
}