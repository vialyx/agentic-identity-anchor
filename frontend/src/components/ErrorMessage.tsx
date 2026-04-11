import clsx from 'clsx'
import { ExclamationCircleIcon } from '@heroicons/react/24/outline'

interface ErrorMessageProps {
  message: string
  title?: string
  className?: string
}

export default function ErrorMessage({ message, title = 'Error', className }: ErrorMessageProps) {
  return (
    <div className={clsx('rounded-md bg-red-50 p-4', className)}>
      <div className="flex">
        <ExclamationCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">{title}</h3>
          <p className="mt-1 text-sm text-red-700">{message}</p>
        </div>
      </div>
    </div>
  )
}
