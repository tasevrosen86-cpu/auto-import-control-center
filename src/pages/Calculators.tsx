import { Calculator, ExternalLink } from 'lucide-react';

const calculators: { name: string; description: string; url: string }[] = [
  {
    name: 'Korea Import Calculator 86',
    description: 'KRW → EUR → крайна себестойност в България',
    url: '/calculators/korea/',
  },
];

export function Calculators() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Calculator className="h-5 w-5 text-slate-500" /> Калкулатори
        </h2>
        <p className="mt-1 text-xs text-slate-500">Отвори калкулатор за изчисление на крайна себестойност.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {calculators.map((calc) => (
          <div key={calc.name} className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600">
                <Calculator className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-800">{calc.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{calc.description}</p>
              </div>
            </div>
            <a
              href={calc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-[#087df5] px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
            >
              Отвори калкулатора <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
