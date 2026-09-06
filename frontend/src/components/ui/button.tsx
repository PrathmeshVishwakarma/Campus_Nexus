import * as React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  className?: string
}

export function Button({ variant = 'default', size = 'default', className, ...props }: ButtonProps) {
  const variants = {
    default: 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:bg-violet-500/90',
    destructive: 'bg-rose-500 text-white hover:bg-rose-400',
    outline: 'border border-violet-600 text-violet-600 hover:bg-violet-600/10',
    secondary: 'bg-[var(--card)] text-[var(--fg)] hover:bg-[var(--card-hover)]',
    ghost: 'hover:bg-[rgba(167,139,250,0.25)]',
    link: 'underline-offset-4 underline',
  }

  const sizes = {
    default: 'px-4 py-2 rounded-xl text-sm font-medium',
    sm: 'px-3 py-2 rounded-lg text-sm',
    lg: 'px-6 py-3 rounded-xl text-base font-medium',
    icon: 'p-2 rounded-md',
  }

  const VariantClass = variants[variant] || variants.default
  const SizeClass = sizes[size] || sizes.default

  return (
    <button
      className={className ? `${VariantClass} ${SizeClass} ${className}` : `${VariantClass} ${SizeClass}`}
      {...props}
    >
      {props.children}
    </button>
  )
}