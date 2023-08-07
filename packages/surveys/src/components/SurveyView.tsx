import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TJsConfig } from "../../../types/v1/js";
import type { TResponseData } from "../../../types/v1/responses";
import type { TSurvey, TSurveyLogic } from "../../../types/v1/surveys";
import { clearStoredResponse, getStoredResponse, storeResponse } from "../lib/localStorage";
import { cn } from "../lib/utils";
import FormbricksSignature from "./FormbricksSignature";
import Progress from "./Progress";
import QuestionConditional from "./QuestionConditional";
import ThankYouCard from "./ThankYouCard";

interface SurveyViewProps {
  config: TJsConfig;
  survey: TSurvey;
  onResponse: (response: TResponseData) => void;
  onAutoClose: () => void;
  brandColor: string;
  formbricksSignature?: boolean;
}

export default function Survey({
  survey,
  onResponse,
  onAutoClose,
  brandColor,
  formbricksSignature = true,
}: SurveyViewProps) {
  const [activeQuestionId, setActiveQuestionId] = useState<string>(survey.questions[0].id);
  const [progress, setProgress] = useState(0); // [0, 1]
  const [loadingElement, setLoadingElement] = useState(false);
  const contentRef = useRef(null);
  const [finished, setFinished] = useState(false);
  const [storedResponseValue, setStoredResponseValue] = useState<any>(null);

  const [countdownProgress, setCountdownProgress] = useState(100);
  const [countdownStop, setCountdownStop] = useState(false);
  const startRef = useRef(performance.now());
  const frameRef = useRef<number | null>(null);

  const showBackButton = progress !== 0 && !finished;

  const handleStopCountdown = () => {
    if (frameRef.current !== null) {
      setCountdownStop(true);
      cancelAnimationFrame(frameRef.current);
    }
  };

  //Scroll to top when question changes
  useLayoutEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeQuestionId]);

  useEffect(() => {
    if (!survey.autoClose) return;
    const frame = () => {
      if (!survey.autoClose || !startRef.current) return;

      const timeout = survey.autoClose * 1000;
      const elapsed = performance.now() - startRef.current;
      const remaining = Math.max(0, timeout - elapsed);

      setCountdownProgress(remaining / timeout);

      if (remaining > 0) {
        frameRef.current = requestAnimationFrame(frame);
      } else {
        handleStopCountdown();
        onAutoClose();
      }
    };

    setCountdownStop(false);
    setCountdownProgress(1);
    frameRef.current = requestAnimationFrame(frame);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [survey.autoClose, close]);

  useEffect(() => {
    setProgress(calculateProgress());

    function calculateProgress() {
      const elementIdx = survey.questions.findIndex((e) => e.id === activeQuestionId);
      return elementIdx / survey.questions.length;
    }
  }, [activeQuestionId, survey]);

  function evaluateCondition(logic: TSurveyLogic, responseValue: any): boolean {
    switch (logic.condition) {
      case "equals":
        return (
          (Array.isArray(responseValue) &&
            responseValue.length === 1 &&
            responseValue.includes(logic.value)) ||
          responseValue.toString() === logic.value
        );
      case "notEquals":
        return responseValue !== logic.value;
      case "lessThan":
        return logic.value !== undefined && responseValue < logic.value;
      case "lessEqual":
        return logic.value !== undefined && responseValue <= logic.value;
      case "greaterThan":
        return logic.value !== undefined && responseValue > logic.value;
      case "greaterEqual":
        return logic.value !== undefined && responseValue >= logic.value;
      case "includesAll":
        return (
          Array.isArray(responseValue) &&
          Array.isArray(logic.value) &&
          logic.value.every((v) => responseValue.includes(v))
        );
      case "includesOne":
        return (
          Array.isArray(responseValue) &&
          Array.isArray(logic.value) &&
          logic.value.some((v) => responseValue.includes(v))
        );
      case "accepted":
        return responseValue === "accepted";
      case "clicked":
        return responseValue === "clicked";
      case "submitted":
        if (typeof responseValue === "string") {
          return responseValue !== "dismissed" && responseValue !== "" && responseValue !== null;
        } else if (Array.isArray(responseValue)) {
          return responseValue.length > 0;
        } else if (typeof responseValue === "number") {
          return responseValue !== null;
        }
        return false;
      case "skipped":
        return (
          (Array.isArray(responseValue) && responseValue.length === 0) ||
          responseValue === "" ||
          responseValue === null ||
          responseValue === "dismissed"
        );
      default:
        return false;
    }
  }

  function getNextQuestionId() {
    const questions = survey.questions;
    const currentQuestionIndex = questions.findIndex((q) => q.id === activeQuestionId);
    if (currentQuestionIndex === -1) throw new Error("Question not found");

    return questions[currentQuestionIndex + 1]?.id || "end";
  }

  function goToNextQuestion(answer: TResponseData): void {
    setLoadingElement(true);
    const questions = survey.questions;
    const nextQuestionId = getNextQuestionId();

    if (nextQuestionId === "end") {
      submitResponse(answer);
      return;
    }

    const nextQuestion = questions.find((q) => q.id === nextQuestionId);
    if (!nextQuestion) throw new Error("Question not found");

    setStoredResponseValue(getStoredResponse(survey.id, nextQuestionId));
    setActiveQuestionId(nextQuestionId);
    setLoadingElement(false);
  }

  function getPreviousQuestionId() {
    const questions = survey.questions;
    const currentQuestionIndex = questions.findIndex((q) => q.id === activeQuestionId);
    if (currentQuestionIndex === -1) throw new Error("Question not found");

    return questions[currentQuestionIndex - 1]?.id;
  }

  function goToPreviousQuestion(answer: TResponseData) {
    setLoadingElement(true);
    const previousQuestionId = getPreviousQuestionId();
    if (!previousQuestionId) throw new Error("Question not found");

    if (answer) {
      storeResponse(survey.id, answer);
    }

    setStoredResponseValue(getStoredResponse(survey.id, previousQuestionId));
    setActiveQuestionId(previousQuestionId);
    setLoadingElement(false);
  }

  const submitResponse = async (data: TResponseData) => {
    setLoadingElement(true);
    const questions = survey.questions;
    const nextQuestionId = getNextQuestionId();
    const currentQuestion = questions[activeQuestionId];
    const responseValue = data[activeQuestionId];

    if (currentQuestion?.logic && currentQuestion?.logic.length > 0) {
      for (let logic of currentQuestion.logic) {
        if (!logic.destination) continue;

        if (evaluateCondition(logic, responseValue)) {
          return logic.destination;
        }
      }
    }

    await onResponse(responseValue);
    setLoadingElement(false);

    if (!finished && nextQuestionId !== "end") {
      setStoredResponseValue(getStoredResponse(survey.id, nextQuestionId));
      setActiveQuestionId(nextQuestionId);
    } else {
      setProgress(100);
      setFinished(true);
      clearStoredResponse(survey.id);
      if (survey.thankYouCard.enabled) {
        setTimeout(() => {
          close();
        }, 2000);
      } else {
        close();
      }
    }
  };

  return (
    <div>
      {!countdownStop && survey.autoClose && (
        <Progress progress={countdownProgress} brandColor={brandColor} />
      )}
      <div
        ref={contentRef}
        className={cn(
          loadingElement ? "fb-animate-pulse fb-opacity-60" : "",
          "fb-text-slate-800 fb-font-sans fb-px-4 fb-py-6 sm:fb-p-6 fb-max-h-[80vh] fb-overflow-y-auto"
        )}
        onClick={() => handleStopCountdown()}
        onMouseOver={() => handleStopCountdown()}>
        {progress === 100 && survey.thankYouCard.enabled ? (
          <ThankYouCard
            headline={survey.thankYouCard.headline}
            subheader={survey.thankYouCard.subheader}
            brandColor={brandColor}
          />
        ) : (
          survey.questions.map(
            (question, idx) =>
              activeQuestionId === question.id && (
                <QuestionConditional
                  key={question.id}
                  brandColor={brandColor}
                  lastQuestion={idx === survey.questions.length - 1}
                  onSubmit={submitResponse}
                  question={question}
                  storedResponseValue={storedResponseValue}
                  goToNextQuestion={goToNextQuestion}
                  goToPreviousQuestion={showBackButton ? goToPreviousQuestion : undefined}
                />
              )
          )
        )}
      </div>
      {formbricksSignature && <FormbricksSignature />}
      <Progress progress={progress} brandColor={brandColor} />
    </div>
  );
}
