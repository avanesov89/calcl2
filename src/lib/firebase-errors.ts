export function translateFirebaseError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  switch (code) {
    case "auth/email-already-in-use":
      return "Этот email уже зарегистрирован.";
    case "auth/invalid-email":
      return "Проверьте формат email.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Неверный email или пароль.";
    case "auth/weak-password":
      return "Пароль должен быть не короче 6 символов.";
    case "auth/too-many-requests":
      return "Слишком много попыток. Попробуйте позже.";
    case "permission-denied":
      return "Недостаточно прав для этой операции.";
    case "unavailable":
      return "Firebase временно недоступен. Проверьте подключение.";
    default:
      return error instanceof Error ? error.message : "Не удалось выполнить действие.";
  }
}
