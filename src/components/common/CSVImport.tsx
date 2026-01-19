import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileText, CheckCircle, AlertCircle, Download } from 'lucide-react';

interface CSVImportProps {
  title: string;
  description: string;
  templateColumns: string[];
  templateExample: string[][];
  onImport: (data: Record<string, string>[]) => Promise<{ success: number; failed: number }>;
  onClose: () => void;
}

export function CSVImport({ 
  title, 
  description, 
  templateColumns, 
  templateExample,
  onImport, 
  onClose 
}: CSVImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }
    
    setFile(selectedFile);
    setError(null);
    setResult(null);
    parseCSV(selectedFile);
  };

  const parseCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          setError('CSV must have a header row and at least one data row');
          return;
        }
        
        const headers = parseCSVLine(lines[0]);
        const data: Record<string, string>[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const row: Record<string, string> = {};
          headers.forEach((header, idx) => {
            row[header.trim().toLowerCase()] = values[idx]?.trim() || '';
          });
          data.push(row);
        }
        
        setPreview(data.slice(0, 5)); // Show first 5 rows
      } catch (err) {
        setError('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const handleImport = async () => {
    if (!file) return;
    
    setImporting(true);
    setError(null);
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        const headers = parseCSVLine(lines[0]);
        const data: Record<string, string>[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const row: Record<string, string> = {};
          headers.forEach((header, idx) => {
            row[header.trim().toLowerCase()] = values[idx]?.trim() || '';
          });
          data.push(row);
        }
        
        const result = await onImport(data);
        setResult(result);
        setImporting(false);
      };
      reader.readAsText(file);
    } catch (err) {
      setError('Import failed. Please check your file format.');
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const header = templateColumns.join(',');
    const rows = templateExample.map(row => row.join(','));
    const csv = [header, ...rows].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-warm-400 mb-6">{description}</p>

        {/* Template Download */}
        <div className="bg-warm-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-white">Need a template?</h4>
              <p className="text-xs text-warm-400 mt-1">
                Download our CSV template with the correct column headers
              </p>
            </div>
            <button
              onClick={downloadTemplate}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Template
            </button>
          </div>
          
          <div className="mt-3 text-xs text-warm-500">
            <strong>Required columns:</strong> {templateColumns.join(', ')}
          </div>
        </div>

        {/* File Upload */}
        {!result && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              file ? 'border-primary bg-primary/5' : 'border-warm-600 hover:border-warm-500'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-primary" />
                <div className="text-left">
                  <div className="font-medium text-white">{file.name}</div>
                  <div className="text-xs text-warm-400">
                    {preview.length} rows to import
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 text-warm-500 mx-auto mb-3" />
                <p className="text-warm-400">Click to select a CSV file</p>
                <p className="text-xs text-warm-500 mt-1">or drag and drop</p>
              </>
            )}
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && !result && (
          <div className="mt-6">
            <h4 className="text-sm font-medium text-warm-400 mb-2">Preview (first 5 rows)</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-warm-700">
                    {Object.keys(preview[0]).map(key => (
                      <th key={key} className="text-left py-2 px-2 text-warm-400 font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b border-warm-800">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="py-2 px-2 text-white">
                          {val || <span className="text-warm-600">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-6 p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h4 className="text-lg font-bold text-white">Import Complete</h4>
            <p className="text-warm-400 mt-2">
              <span className="text-emerald-400 font-bold">{result.success}</span> items imported successfully
              {result.failed > 0 && (
                <>, <span className="text-red-400 font-bold">{result.failed}</span> failed</>
              )}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 btn-secondary">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Import {preview.length} Rows
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default CSVImport;
