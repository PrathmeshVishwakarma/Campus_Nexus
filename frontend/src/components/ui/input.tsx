import * as React from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  type?: 'text' | 'email' | 'password' | 'file'
  className?: string
}

export function Input({ type = 'text', className, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={className ? `block w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)] ${className}` : `block w-full bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 outline-none text-[var(--fg)] placeholder-[var(--muted)] focus:ring-2 focus:ring-[var(--accent)]`}
      {...props}
    />
  )
}