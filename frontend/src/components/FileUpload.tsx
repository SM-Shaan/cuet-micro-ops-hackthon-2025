import { useState, useEffect } from "react";

interface UploadedFile {
  key: string;
  size: number;
  lastModified: string;
  fileId: number | null;
}

interface UploadResult {
  success: boolean;
  fileId: number;
  s3Key: string;
  size: number;
  message: string;
}

const API_BASE = "/api";

export function FileUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileId, setFileId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fetch list of files
  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/v1/files`);
      const data = await response.json();
      if (response.ok) {
        setFiles(data.files || []);
      } else {
        setError(data.message || "Failed to fetch files");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch files");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Handle file upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !fileId) {
      setError("Please select a file and enter a file ID");
      return;
    }

    const fileIdNum = parseInt(fileId, 10);
    if (isNaN(fileIdNum) || fileIdNum < 10000 || fileIdNum > 100000000) {
      setError("File ID must be between 10,000 and 100,000,000");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("file_id", fileId);

      const response = await fetch(`${API_BASE}/v1/upload`, {
        method: "POST",
        body: formData,
      });

      const data: UploadResult = await response.json();

      if (response.ok && data.success) {
        setSuccess(`File uploaded successfully! S3 Key: ${data.s3Key}`);
        setSelectedFile(null);
        setFileId("");
        // Reset file input
        const fileInput = document.getElementById("file-input") as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        // Refresh file list
        fetchFiles();
      } else {
        setError(data.message || "Upload failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Upload File to S3</h2>

        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              File ID (10,000 - 100,000,000)
            </label>
            <input
              type="number"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              placeholder="Enter file ID (e.g., 70000)"
              min="10000"
              max="100000000"
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Select File
            </label>
            <input
              id="file-input"
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-500 file:text-white hover:file:bg-blue-600"
            />
            {selectedFile && (
              <p className="mt-2 text-sm text-gray-400">
                Selected: {selectedFile.name} ({formatSize(selectedFile.size)})
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={uploading || !selectedFile || !fileId}
            className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {uploading ? "Uploading..." : "Upload File"}
          </button>
        </form>

        {/* Messages */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-300">
            {success}
          </div>
        )}
      </div>

      {/* File List */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Files in S3 Bucket</h2>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-sm rounded-lg transition-colors"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            No files in bucket. Upload a file to get started!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-3 font-medium">File ID</th>
                  <th className="pb-3 font-medium">S3 Key</th>
                  <th className="pb-3 font-medium">Size</th>
                  <th className="pb-3 font-medium">Last Modified</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => (
                  <tr key={index} className="border-b border-gray-700/50">
                    <td className="py-3">
                      <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-sm font-mono">
                        {file.fileId ?? "-"}
                      </span>
                    </td>
                    <td className="py-3 text-gray-300 font-mono text-sm">
                      {file.key}
                    </td>
                    <td className="py-3 text-gray-300">{formatSize(file.size)}</td>
                    <td className="py-3 text-gray-400 text-sm">
                      {formatDate(file.lastModified)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-400">
          Total files: {files.length}
        </div>
      </div>
    </div>
  );
}
