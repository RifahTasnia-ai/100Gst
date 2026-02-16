import { useState, useEffect, useCallback } from 'react'
import ExamHeader from './ExamHeader'
import QuestionCard from './QuestionCard'
import SidebarGrid from './SidebarGrid'
import ResultSummary from './ResultSummary'
import SubmissionStatus from './SubmissionStatus'
import { saveSubmission, savePendingStudent, removePendingStudent } from '../utils/api'
import { queueSubmission, processSubmission, startBackgroundSync } from '../utils/SubmissionManager'
import './MCQContainer.css'


const STATUS = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  SUBMITTED: 'SUBMITTED'
}

const DURATION_SECONDS = 60 * 60 // 60 minutes
const MARK_PER_QUESTION = 1.0 // Each correct answer = 1 mark
const NEGATIVE_MARKING = 0.25
const PASS_MARK = 60.0 // 100 * 1.0 * 0.60

function MCQContainer({ questions, studentName, questionFile = 'questions.json' }) {
  console.log('MCQContainer rendered:', {
    hasQuestions: !!questions,
    isArray: Array.isArray(questions),
    length: questions?.length,
    studentName
  })

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  const [status, setStatus] = useState(STATUS.RUNNING)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [visitedQuestions, setVisitedQuestions] = useState(new Set([0]))
  const [timeLeft, setTimeLeft] = useState(DURATION_SECONDS)
  const [markedForReview, setMarkedForReview] = useState(new Set())
  const [examStartTime] = useState(Date.now()) // Track when exam started (used for local display only)
  const [pendingSent, setPendingSent] = useState(false) // Track if pending status was sent
  const [submissionStatus, setSubmissionStatus] = useState({ status: 'idle', retryCount: 0 })

  // All useCallback hooks must be defined before any returns
  const handleAnswerSelect = useCallback((questionId, optionId) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: optionId
    }))
    setVisitedQuestions(prev => new Set([...prev, currentQuestionIndex]))
  }, [currentQuestionIndex])

  const handleQuestionJump = useCallback((index) => {
    if (questions && index >= 0 && index < questions.length) {
      setCurrentQuestionIndex(index)
      setVisitedQuestions(prev => new Set([...prev, index]))
    }
  }, [questions])

  const handlePrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => {
        const newIndex = prev - 1
        setVisitedQuestions(prevSet => new Set([...prevSet, newIndex]))
        return newIndex
      })
    }
  }, [currentQuestionIndex])

  const handleNext = useCallback(() => {
    if (questions && currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => {
        const newIndex = prev + 1
        setVisitedQuestions(prevSet => new Set([...prevSet, newIndex]))
        return newIndex
      })
    }
  }, [currentQuestionIndex, questions])

  const toggleMarkForReview = useCallback(() => {
    setMarkedForReview(prev => {
      const newSet = new Set(prev)
      if (newSet.has(currentQuestionIndex)) {
        newSet.delete(currentQuestionIndex)
      } else {
        newSet.add(currentQuestionIndex)
      }
      return newSet
    })
  }, [currentQuestionIndex])

  const calculateScore = useCallback(() => {
    if (!questions || !Array.isArray(questions)) return { score: 0, correct: 0, wrong: 0, attempted: 0, total: 0, subjectStats: {} }

    let correct = 0
    let wrong = 0
    const subjectStats = {}

    questions.forEach(q => {
      const subject = q.subject || 'General'
      if (!subjectStats[subject]) {
        subjectStats[subject] = { correct: 0, wrong: 0, attempted: 0, total: 0 }
      }
      subjectStats[subject].total++

      const selected = answers[q.id]
      if (!selected) return

      subjectStats[subject].attempted++
      if (selected === q.correctOptionId) {
        correct++
        subjectStats[subject].correct++
      } else {
        wrong++
        subjectStats[subject].wrong++
      }
    })

    // Calculate percentages for each subject
    Object.keys(subjectStats).forEach(subject => {
      const stats = subjectStats[subject]
      stats.percentage = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
    })

    const score = Math.max(correct * MARK_PER_QUESTION - wrong * NEGATIVE_MARKING, 0)
    return {
      score,
      correct,
      wrong,
      attempted: correct + wrong,
      total: questions.length,
      subjectStats
    }
  }, [questions, answers])

  const handleSubmit = useCallback(async () => {
    if (status === STATUS.SUBMITTED) return

    const scoreData = calculateScore()
    const payload = {
      studentName,
      answers,
      score: parseFloat(scoreData.score.toFixed(2)),
      totalMarks: scoreData.total * MARK_PER_QUESTION,
      timestamp: new Date().toISOString(),
      attempted: scoreData.attempted,
      correct: scoreData.correct,
      wrong: scoreData.wrong,
      pass: scoreData.score >= PASS_MARK,
      questionFile: questionFile
    }

    // Immediately queue the submission to localStorage for insurance
    const queueId = queueSubmission(payload)
    console.log('📝 Submission queued locally:', queueId)

    // Show result screen immediately
    setStatus(STATUS.SUBMITTED)

    // Start attempting to submit in background
    const queueItem = { id: queueId, payload, retryCount: 0 }

    processSubmission(queueItem, (progress) => {
      setSubmissionStatus(progress)

      if (progress.status === 'success') {
        // Clean up only on confirmed success
        localStorage.removeItem(`mcq_state_v100_${studentName}`)
        localStorage.removeItem('exam_session_student')
      }
    }).catch(err => {
      console.error('Submission error:', err)
      // Don't remove anything - let retry mechanism handle it
    })
  }, [status, studentName, answers, questions, calculateScore, questionFile])

  // All useEffect hooks must be called before any returns
  useEffect(() => {
    if (!questions || questions.length === 0) return

    const saved = localStorage.getItem(`mcq_state_v100_${studentName}`)
    if (saved) {
      try {
        const data = JSON.parse(saved)
        setAnswers(data.answers || {})
        const maxIndex = Math.max(0, questions.length - 1)
        setCurrentQuestionIndex(Math.min(data.currentIndex || 0, maxIndex))
        setTimeLeft(data.timeLeft ?? DURATION_SECONDS)
        setVisitedQuestions(new Set(data.visited || [0]))
        setMarkedForReview(new Set(data.marked || []))
      } catch (e) {
        console.error('Failed to load saved state', e)
      }
    }
  }, [studentName, questions])

  useEffect(() => {
    if (status === STATUS.RUNNING) {
      const state = {
        answers,
        currentIndex: currentQuestionIndex,
        timeLeft,
        visited: Array.from(visitedQuestions),
        marked: Array.from(markedForReview)
      }
      localStorage.setItem(`mcq_state_v100_${studentName}`, JSON.stringify(state))
    }
  }, [answers, currentQuestionIndex, timeLeft, visitedQuestions, markedForReview, status, studentName])

  // Timer - must be after handleSubmit definition
  useEffect(() => {
    if (status !== STATUS.RUNNING || timeLeft <= 0) return

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleSubmit()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [status, timeLeft, handleSubmit])

  // Safety check for current question index
  useEffect(() => {
    if (questions && questions.length > 0 && (currentQuestionIndex < 0 || currentQuestionIndex >= questions.length)) {
      setCurrentQuestionIndex(0)
    }
  }, [currentQuestionIndex, questions])

  // Track pending students - First after 1 minute, then every 5 minutes
  useEffect(() => {
    if (status !== STATUS.RUNNING) return

    const ONE_MINUTE = 1 * 60 * 1000 // 1 minute
    const THIRTY_SECONDS = 30 * 1000 // 30 seconds

    // 1. Initial trigger after 1 minute
    const initialTimer = setTimeout(() => {
      if (!pendingSent) {
        setPendingSent(true)
        savePendingStudent(studentName, null, {
          answers,
          currentQuestion: currentQuestionIndex + 1,
          answeredCount: Object.keys(answers).length,
          totalQuestions: questions.length,
          questionFile
        })
          .then(() => {
            console.log(`${studentName} marked as pending after 1 minute`)
          })
          .catch(err => console.error('Failed to save pending student (1 min):', err))
      }
    }, ONE_MINUTE)

    // 2. Heartbeat every 30 seconds (syncs answers for spectate)
    const heartbeatInterval = setInterval(() => {
      savePendingStudent(studentName, null, {
        answers,
        currentQuestion: currentQuestionIndex + 1,
        answeredCount: Object.keys(answers).length,
        totalQuestions: questions.length,
        questionFile
      })
        .then(() => {
          console.log(`Heartbeat: ${studentName} synced ${Object.keys(answers).length} answers`)
        })
        .catch(err => console.error('Failed to send heartbeat:', err))
    }, THIRTY_SECONDS)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(heartbeatInterval)
    }
  }, [status, pendingSent, studentName, answers, currentQuestionIndex, questions, questionFile])

  // Background sync for pending submissions (network reconnection handling)
  useEffect(() => {
    const cleanup = startBackgroundSync((progress) => {
      setSubmissionStatus(progress)
    })

    return cleanup
  }, [])

  // NOW we can do conditional returns after all hooks
  // Validate questions array AFTER all hooks (React rules)
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    console.error('MCQContainer: Invalid questions array', { questions })
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        backgroundColor: 'var(--gray-50)'
      }}>
        <div style={{ color: 'var(--error)', fontSize: '18px', textAlign: 'center' }} className="bengali">
          প্রশ্ন পাওয়া যায়নি। দয়া করে পৃষ্ঠাটি রিফ্রেশ করুন।
        </div>
        <div style={{ color: 'var(--gray-600)', fontSize: '14px', marginTop: '8px', textAlign: 'center' }}>
          {!questions ? 'Questions is null/undefined' :
            !Array.isArray(questions) ? 'Questions is not an array' :
              questions.length === 0 ? 'Questions array is empty' : 'Unknown error'}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            backgroundColor: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px',
            marginTop: '8px'
          }}
          className="bengali"
        >
          রিফ্রেশ করুন
        </button>
      </div>
    )
  }

  if (status === STATUS.SUBMITTED) {
    return (
      <ResultSummary
        questions={questions}
        answers={answers}
        studentName={studentName}
        score={calculateScore()}
        onRestart={() => window.location.reload()}
        questionFile={questionFile}
        submissionStatus={submissionStatus}
      />
    )
  }

  const safeIndex = Math.max(0, Math.min(currentQuestionIndex, questions.length - 1))
  const currentQuestion = questions[safeIndex]

  if (!currentQuestion) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh'
      }}>
        <div className="bengali">প্রশ্ন লোড হচ্ছে...</div>
      </div>
    )
  }

  try {
    return (
      <div className="mcq-container">
        <ExamHeader
          examName="MCQ Exam"
          timeLeft={timeLeft}
          totalQuestions={questions.length}
        />
        <div className="mcq-content">
          <div className="question-section">
            <QuestionCard
              question={currentQuestion}
              questionNumber={safeIndex + 1}
              selectedAnswer={answers[currentQuestion.id]}
              onAnswerSelect={handleAnswerSelect}
              onPrev={handlePrev}
              onNext={handleNext}
              canGoPrev={safeIndex > 0}
              canGoNext={safeIndex < questions.length - 1}
              isMarked={markedForReview.has(safeIndex)}
              onToggleMark={toggleMarkForReview}
              onSubmit={handleSubmit}
            />
          </div>
          <SidebarGrid
            totalQuestions={questions.length}
            currentIndex={safeIndex}
            answers={answers}
            questions={questions}
            visitedQuestions={visitedQuestions}
            markedQuestions={markedForReview}
            onQuestionJump={handleQuestionJump}
          />
        </div>

        <SubmissionStatus {...submissionStatus} />
      </div>
    )
  } catch (error) {
    console.error('MCQContainer render error:', error)
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px'
      }}>
        <div style={{ color: 'var(--error)', fontSize: '18px' }} className="bengali">
          রেন্ডারিং ত্রুটি: {error.message}
        </div>
        <button onClick={() => window.location.reload()} className="bengali">
          রিফ্রেশ করুন
        </button>
      </div>
    )
  }
}

export default MCQContainer


