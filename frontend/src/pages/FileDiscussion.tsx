import { Navigate, useSearchParams } from 'react-router-dom'

/** Old deep link (/files/discussion?path=…): the discussion now lives in the Files panel. */
export default function FileDiscussion() {
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  return <Navigate replace to={path ? `/files?file=${encodeURIComponent(path)}&tab=discussion` : '/files'} />
}
