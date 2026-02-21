import { useState, useEffect, useMemo, useRef } from 'react'
import { loadSubmissions, deleteSubmission, deleteStudent, loadPendingStudents, removePendingStudent } from '../utils/api'
import SubmissionsTable from '../components/admin/SubmissionsTable'
import NotificationToast from '../components/admin/NotificationToast'
import QuestionSetModal from '../components/admin/QuestionSetModal'
import './AdminPage.css'

function AdminPage() {
  const [submissions, setSubmissions] = useState([])
  const [pendingStudents, setPendingStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('all-subjects')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notification, setNotification] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const loadDataRef = useRef(null)
  const itemsPerPage = 7


  useEffect(() => {
    loadData()
    loadDataRef.current = loadData
  }, [])

  // Auto-refresh every 30 seconds + immediately when admin tab becomes visible again
  useEffect(() => {
    loadDataRef.current = loadData
  })

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => { loadData() }, 30000)

    // Fix WK-2: When admin tab comes back to foreground, refresh immediately
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadDataRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [autoRefresh])

  async function loadData() {
    try {
      setLoading(true)
      const [submissionsData, pendingData] = await Promise.all([
        loadSubmissions(),
        loadPendingStudents().catch(() => []) // Don't fail if pending students file doesn't exist
      ])
      setSubmissions(submissionsData)
      setPendingStudents(pendingData)
      setError(null)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message)
      console.error('Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(studentName, timestamp) {
    if (!window.confirm(`আপনি কি ${studentName} এর উত্তর মুছে ফেলতে চান?\n\nএই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`)) {
      return
    }

    try {
      await deleteSubmission(studentName, timestamp)
      await loadData()
      setNotification({ message: `${studentName} এর উত্তর সফলভাবে মুছে ফেলা হয়েছে`, type: 'success' })
    } catch (err) {
      console.error('Delete failed:', err)
      setNotification({ message: `মুছে ফেলতে সমস্যা হয়েছে: ${err.message}`, type: 'error' })
    }
  }

  async function handleDeleteStudent(studentName) {
    if (!window.confirm(`আপনি কি ${studentName} এর সকল উত্তর মুছে ফেলতে চান?\n\nএই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`)) {
      return
    }

    const results = await Promise.allSettled([
      deleteStudent(studentName),
      removePendingStudent(studentName)
    ])

    const anySuccess = results.some(result => result.status === 'fulfilled')
    if (anySuccess) {
      await loadData()
      setNotification({ message: `${studentName} এর সকল উত্তর সফলভাবে মুছে ফেলা হয়েছে`, type: 'success' })
      return
    }

    const errorMessage = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason?.message || 'Unknown delete error')
      .join(' | ')

    setNotification({ message: `মুছে ফেলতে সমস্যা হয়েছে: ${errorMessage}`, type: 'error' })
  }

  // Group submissions by student (latest only) and merge with pending students
  const submissionsByStudent = useMemo(() => {
    // --- FILTER OLD DATA FROM DISPLAY ---
    const now = Date.now();
    const groups = {}

    // 1. No filtering by time - show all submissions
    const validSubmissions = submissions;

    // 2. Group submissions by student (latest only)
    validSubmissions.forEach(sub => {
      const studentKey = sub.studentId || sub.studentName
      if (!groups[studentKey] || new Date(sub.timestamp) > new Date(groups[studentKey].timestamp)) {
        groups[studentKey] = sub
      }
    })

    // 3. Add pending students who are currently taking an exam
    pendingStudents.forEach(pending => {
      const studentKey = pending.studentName

      // Calculate elapsed time
      const start = new Date(pending.timestamp).getTime()
      const elapsed = now - start

      // Filter out pending students older than 61 minutes (exam timeout)
      const SIXTY_ONE_MINUTES_MS = 61 * 60 * 1000;
      if (elapsed > SIXTY_ONE_MINUTES_MS) return;

      const minutes = Math.floor(elapsed / (1000 * 60))
      const TIMEOUT_THRESHOLD = 60

      const pendingEntry = {
        ...pending,
        studentName: pending.studentName,
        timestamp: pending.timestamp,
        status: 'Pending',
        isPending: true,
        isExpired: minutes > TIMEOUT_THRESHOLD,
        elapsedMinutes: minutes
      }

      if (!groups[studentKey]) {
        // No existing submission - show as pending
        groups[studentKey] = pendingEntry
      } else {
        // Student already has a submission. Check if the pending entry is NEWER
        // (meaning they started a new exam after their last submission)
        const existingTimestamp = new Date(groups[studentKey].timestamp).getTime()
        const pendingTimestamp = new Date(pending.timestamp).getTime()

        if (pendingTimestamp > existingTimestamp) {
          // Keep the old submission under a unique key so it's not lost
          const oldKey = `${studentKey}_submitted_${groups[studentKey].timestamp}`
          groups[oldKey] = groups[studentKey]
          // Replace with the pending entry
          groups[studentKey] = pendingEntry
        }
      }
    })

    return Object.values(groups)
  }, [submissions, pendingStudents])

  // Filter submissions
  const filteredSubmissions = useMemo(() => {
    let filtered = submissionsByStudent

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(sub =>
        sub.studentName?.toLowerCase().includes(term) ||
        sub.studentId?.toLowerCase().includes(term)
      )
    }

    // Filter by subject
    if (subjectFilter !== 'all-subjects') {
      filtered = filtered.filter(sub => {
        // Pending students might not have questionFile, so we might want to show them in 'all' or specific if we knew their subject
        // For now, if they don't have questionFile, they only appear in 'all-subjects'
        if (!sub.questionFile) return false

        const fileName = sub.questionFile.toLowerCase()
        const fileDisplayName = (sub.questionSetDisplayName || '').toLowerCase() // Fallback if we add this later

        if (subjectFilter === 'biology') {
          return fileName.includes('biology') || fileName.includes('জীববিজ্ঞান')
        } else if (subjectFilter === 'chemistry') {
          return fileName.includes('chemistry') || fileName.includes('chem') || fileName.includes('রসায়ন')
        } else if (subjectFilter === 'physics') {
          return fileName.includes('physics') || fileName.includes('পদার্থ') || fileName.includes('questions2')
        } else if (subjectFilter === 'math') {
          return fileName.includes('math') || fileName.includes('গণিত')
        }
        return true
      })
    }

    // Sort: Pending first, then by timestamp - most recent first
    filtered = filtered.sort((a, b) => {
      // Pending students come first
      if (a.isPending && !b.isPending) return -1
      if (!a.isPending && b.isPending) return 1
      // Otherwise sort by timestamp
      return new Date(b.timestamp) - new Date(a.timestamp)
    })

    return filtered
  }, [submissionsByStudent, searchTerm, subjectFilter])

  // Pagination
  const totalPages = Math.ceil(filteredSubmissions.length / itemsPerPage)
  const paginatedSubmissions = filteredSubmissions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  // Stats
  const stats = useMemo(() => {
    const total = submissionsByStudent.length
    const passed = submissionsByStudent.filter(s => s.pass).length
    const failed = total - passed
    const avgScore = total > 0
      ? (submissionsByStudent.reduce((sum, s) => sum + (s.score || 0), 0) / total).toFixed(1)
      : 0
    return { total, passed, failed, avgScore }
  }, [submissionsByStudent])

  if (error) {
    return (
      <div className="admin-page">
        <div className="error-state">
          <h2 className="bengali">লোড করতে সমস্যা হয়েছে</h2>
          <p>{error}</p>
          <button onClick={loadData} className="export-button">আবার চেষ্টা করুন</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-header">
        <h1 className="bengali">শিক্ষার্থী ডাটাবেস</h1>
        <div className="admin-header-right">
          <div className="stats-badge bengali">
            মোট: <strong>{stats.total}</strong>
          </div>
          <button
            className={`icon-button ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'অটো রিফ্রেশ চালু' : 'অটো রিফ্রেশ বন্ধ'}
          >
            🔄
          </button>
          <button
            className="icon-button"
            onClick={loadData}
            title="রিফ্রেশ করুন"
            disabled={loading}
          >
            ↻
          </button>
          <button
            className="icon-button"
            onClick={() => setShowSettingsModal(true)}
            title="প্রশ্ন সেট সেটিংস"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="admin-content">
        {/* Filter Bar */}
        <div className="filter-bar">
          <input
            type="text"
            className="search-input bengali"
            placeholder="নাম বা আইডি দিয়ে খুঁজুন..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <select
            className="filter-select bengali"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="all-subjects">সকল বিষয়</option>
            <option value="biology">জীববিজ্ঞান</option>
            <option value="chemistry">রসায়ন</option>
            <option value="physics">পদার্থবিজ্ঞান</option>
            <option value="math">গণিত</option>
          </select>

          <button className="export-button bengali" onClick={() => alert('Export feature coming soon!')}>
            📥 Export CSV
          </button>
        </div>

        {/* Data Table */}
        <SubmissionsTable
          submissions={paginatedSubmissions}
          onDelete={handleDelete}
          onDeleteStudent={handleDeleteStudent}
          loading={loading}
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredSubmissions.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Notification Toast */}
      {notification && (
        <NotificationToast
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Question Set Settings Modal */}
      <QuestionSetModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSave={(fileName) => {
          setNotification({
            message: `প্রশ্ন সেট সফলভাবে সংরক্ষিত হয়েছে: ${fileName}`,
            type: 'success'
          })
        }}
      />
    </div>
  )
}

export default AdminPage
