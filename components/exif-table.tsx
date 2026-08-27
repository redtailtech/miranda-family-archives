const CURATED: [key: string, label: string][] = [
  ['Make', 'Camera make'], ['Model', 'Camera model'], ['LensModel', 'Lens'],
  ['DateTimeOriginal', 'Taken'], ['ExposureTime', 'Shutter (s)'], ['FNumber', 'Aperture (f/)'],
  ['ISO', 'ISO'], ['FocalLength', 'Focal length (mm)'], ['ImageWidth', 'Width (px)'],
  ['ImageHeight', 'Height (px)'], ['XResolution', 'X resolution'], ['YResolution', 'Y resolution'],
  ['GPSLatitude', 'Latitude'], ['GPSLongitude', 'Longitude'], ['Software', 'Software'],
  ['PageCount', 'Pages'], ['PDFVersion', 'PDF version'], ['Producer', 'Produced by'],
]

function show(v: unknown): string {
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

export function ExifTable({ exif, type }: { exif: Record<string, unknown> | null | undefined; type: string }) {
  if (!exif || Object.keys(exif).length === 0)
    return <p className="text-lg">No metadata was found in this file.</p>
  const curatedPresent = CURATED.filter(([k]) => exif[k] != null)
  const curatedKeys = new Set(curatedPresent.map(([k]) => k))
  const rest = Object.entries(exif).filter(([k]) => !curatedKeys.has(k))
  return (
    <div className="grid gap-6">
      {curatedPresent.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full max-w-xl text-lg">
            <tbody>
              {curatedPresent.map(([key, label]) => (
                <tr key={key} className="border-b">
                  <td className="py-2 pr-6 font-semibold">{label}</td>
                  <td className="py-2">{show(exif[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-lg underline">
          All {type === 'DOCUMENT' ? 'document' : 'photo'} metadata ({rest.length} more fields)
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rest.map(([key, value]) => (
                <tr key={key} className="border-b align-top">
                  <td className="py-1 pr-4 font-mono">{key}</td>
                  <td className="py-1 break-all">{show(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
