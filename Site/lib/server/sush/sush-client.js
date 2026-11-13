// Native fetch
const undiciFetch = globalThis.fetch;
class ProxyAgent {}

const DEFAULT_BASE_URL = process.env.SUSH_BASE_URL || "https://sush.tasmukhambetov-t08.workers.dev";
const DETAIL_CONCURRENCY = 2;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  return splitSetCookieHeader(headers.get("set-cookie"));
}

function toStringOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function toFormBody(form) {
  if (!form) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value === null || value === undefined) continue;
    params.append(key, typeof value === "boolean" ? (value ? "True" : "False") : String(value));
  }
  return params;
}

function normalizeReportCardValue(value) {
  if (value === null || value === undefined || value === "none") return "";
  if (value === "true") return "Зачет";
  if (value === "false") return "Незачет";
  if (value === "-2") return "Болел";
  if (value === "-3") return "Освобожден";
  if (value === "0") return "н/а";
  return String(value);
}

export class SushClient {
  /** @param {{ fetchImpl?: typeof fetch, baseUrl?: string, proxyUrl?: string }} [options] */
  constructor({ fetchImpl, baseUrl = DEFAULT_BASE_URL, proxyUrl = process.env.SUSH_PROXY_URL } = {}) {
    if (!fetchImpl) {
      if (proxyUrl && !process.env.SUSH_BASE_URL && baseUrl === "https://sms.akb.nis.edu.kz") {
        // СУШ отключает капчу только для казахстанских IP, поэтому запросы можно
        // направить через прокси с казахстанским адресом.
        const proxyAgent = new ProxyAgent(proxyUrl);
        fetchImpl = (url, init) => undiciFetch(url, { ...init, dispatcher: proxyAgent });
      } else {
        fetchImpl = globalThis.fetch;
      }
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("Node.js fetch API is unavailable");
    }

    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.cookies = new Map();
    this.lastProfile = {};
  }

  buildUrl(endpoint) {
    let str = String(endpoint ?? "");
    if (str.startsWith("https://sms.akb.nis.edu.kz")) {
      str = str.replace("https://sms.akb.nis.edu.kz", this.baseUrl);
    }
    return str.startsWith("http")
      ? str
      : `${this.baseUrl}${str.startsWith("/") ? "" : "/"}${str}`;
  }

  updateCookies(headers) {
    for (const header of getSetCookieHeaders(headers)) {
      const cookie = header.split(";", 1)[0];
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) continue;

      const name = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      if (value) {
        this.cookies.set(name, value);
      } else {
        this.cookies.delete(name);
      }
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  getCookies() {
    return new Map(this.cookies);
  }

  setCookies(cookiesMap) {
    if (cookiesMap instanceof Map) {
      this.cookies = new Map(cookiesMap);
    }
  }

  forkDiarySession() {
    const client = new SushClient({ fetchImpl: this.fetchImpl, baseUrl: this.baseUrl });
    const cookies = this.getCookies();
    cookies.delete("Aktobe_jce_SessionID");
    client.setCookies(cookies);
    return client;
  }

  async requestOnce(endpoint, { method = "GET", form, timeoutMs = 12000 } = {}) {
    let url = this.buildUrl(endpoint);
    let currentMethod = method;
    let currentBody = toFormBody(form);

    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      url = this.buildUrl(url);
      if (new URL(url).origin !== this.origin) throw new Error("Unexpected redirect from SUSH");
      const headers = { "User-Agent": USER_AGENT };
      const cookie = this.cookieHeader();
      if (cookie) headers.Cookie = cookie;
      if (currentBody) {
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }

      const response = await this.fetchImpl(url, {
        method: currentMethod,
        headers,
        body: currentBody,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      this.updateCookies(response.headers);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) return response;

      await response.arrayBuffer();
      url = this.buildUrl(new URL(location, url).toString());
      if ([301, 302, 303].includes(response.status) && currentMethod !== "GET") {
        currentMethod = "GET";
        currentBody = undefined;
      }
    }

    throw new Error("Too many redirects from SUSH");
  }

  async request(endpoint, options = {}, read = response => response.arrayBuffer()) {
    const retries = options.retries ?? 1;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await this.requestOnce(endpoint, options);
        return await read(response);
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(300 * (attempt + 1));
      }
    }

    throw lastError;
  }

  async postJson(endpoint, form, options = {}) {
    const text = await this.request(endpoint, {
      ...options,
      method: "POST",
      form,
    }, response => {
      const returnedToLogin = response.url && /\/account\/login\/?$/i.test(new URL(response.url).pathname);
      if (returnedToLogin || response.status === 401 || response.status === 403) {
        throw new Error("СУШ завершил сеанс. Повторите вход.");
      }
      return response.text();
    });
    try {
      const payload = JSON.parse(text);
      return payload && typeof payload === "object" ? payload : {};
    } catch {
      return {};
    }
  }

  async login(iin, password, captcha) {
    if (!captcha && !this.cookies.size) {
      await this.request(this.baseUrl, { retries: 1, timeoutMs: 10000 });
    }

    const form = { login: iin, password };
    if (captcha) {
      form.captcha = captcha;
      form.captchaInput = captcha;
      form["g-recaptcha-response"] = captcha;
    }

    const payload = await this.postJson(
      "/root/Account/LogOn",
      form,
      { retries: 1, timeoutMs: 16000 },
    );

    if (payload.success) {
      return { success: true };
    }

    const data = (payload.data && typeof payload.data === "object") ? payload.data : {};
    const captchaType = data.captchaType ?? payload.captchaType;
    const captchaData = data.captchaData ?? payload.captchaData;
    const captchaOn = Boolean(
      data.captchaOn ||
      (captchaType && captchaData) ||
      /капч|captcha/i.test(String(payload.message ?? ""))
    );

    if (captchaOn) {
      return {
        success: false,
        captchaRequired: true,
        captchaType: captchaType ?? 1,
        captchaData: captchaData || null,
        message: payload.message || "Требуется ввод защитного кода",
      };
    }

    return {
      success: false,
      message: payload.message || "Ошибка входа. Проверьте логин и пароль.",
    };
  }

  async refreshCaptcha() {
    const payload = await this.postJson(
      "/root/Account/RefreshRestoreCaptcha",
      {},
      { retries: 1, timeoutMs: 12000 },
    );
    const data = (payload.data && typeof payload.data === "object") ? payload.data : {};
    return {
      captchaType: data.captchaType ?? payload.captchaType ?? 1,
      captchaData: data.captchaData ?? payload.captchaData ?? null,
      message: payload.message || null,
    };
  }

  async getSchoolYears() {
    for (const endpoint of ["/Ref/GetSchoolYears?fullData=True", "/Ref/GetSchoolYears"]) {
      const payload = await this.postJson(endpoint, undefined, {
        retries: 2,
        timeoutMs: 12000,
      });
      if (Array.isArray(payload.data) && payload.data.length) return payload.data;
    }
    return [];
  }

  async getPeriods(schoolYearId) {
    const payload = await this.postJson(
      "/Ref/GetPeriods",
      { schoolYearId },
      { retries: 2, timeoutMs: 12000 },
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  matchStudent(student, login) {
    if (!student || typeof student !== "object" || !login) return false;
    const target = String(login).trim();
    if (!target) return false;
    const keys = [
      "IIN",
      "Iin",
      "iin",
      "Login",
      "UserName",
      "Username",
      "Identifier",
      "Idn",
      "BinIin",
      "Pin",
      "PersonalId",
      "Code",
    ];
    return keys.some((key) => String(student[key] ?? "").trim() === target);
  }

  async getDiaryData(periodId, schoolYearId, { skipDetails = false, studentLogin } = {}) {
    const parallels = (
      await this.postJson(
        "/JceDiary/GetParallels",
        { schoolYearId, periodId },
        { retries: 2, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(parallels) || !parallels.length) return [];
    const parallelId = parallels[0].Id;

    const klasses = (
      await this.postJson(
        "/JceDiary/GetKlasses",
        { schoolYearId, periodId, parallelId },
        { retries: 2, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(klasses) || !klasses.length) return [];

    let selectedKlass = klasses[0];
    let selectedStudent;

    if (studentLogin) {
      for (const klass of klasses) {
        const klassStudents = (
          await this.postJson(
            "/JceDiary/GetStudents",
            { schoolYearId, periodId, klassId: klass.Id },
            { retries: 1, timeoutMs: 12000 },
          )
        ).data;
        selectedStudent = Array.isArray(klassStudents)
          ? klassStudents.find((student) => this.matchStudent(student, studentLogin))
          : undefined;
        if (selectedStudent) {
          selectedKlass = klass;
          break;
        }
      }
    }

    if (!selectedStudent) {
      const students = (
        await this.postJson(
          "/JceDiary/GetStudents",
          { schoolYearId, periodId, klassId: selectedKlass.Id },
          { retries: 2, timeoutMs: 12000 },
        )
      ).data;
      if (!Array.isArray(students) || !students.length) return [];
      selectedStudent = students[0];
    }

    this.lastProfile = {
      classRaw: selectedKlass,
      studentRaw: selectedStudent,
      periodId,
      schoolYearId,
    };

    const diaryData = (
      await this.postJson(
        "/JceDiary/GetJceDiary",
        {
          periodId,
          parallelId,
          klassId: selectedKlass.Id,
          studentId: selectedStudent.Id,
        },
        { retries: 2, timeoutMs: 14000 },
      )
    ).data;
    if (!diaryData?.Url) return [];

    await this.request(diaryData.Url, { retries: 1, timeoutMs: 14000 });
    const subjects = (
      await this.postJson("/Jce/Diary/GetSubjects", undefined, {
        retries: 2,
        timeoutMs: 12000,
      })
    ).data;
    if (!Array.isArray(subjects)) return [];

    const parsedSubjects = subjects.map((subject) => ({
      id: subject.Id ?? "",
      name: subject.Name ?? "",
      journalId: String(subject.JournalId ?? ""),
      score: toStringOrEmpty(subject.Score),
      mark: toStringOrEmpty(subject.Mark),
      markComment: toStringOrEmpty(subject.MarkComment),
      evaluations: (subject.Evaluations ?? []).map((evaluation) => {
        let maxScore = evaluation.MaxScore;
        if (!maxScore && evaluation.MaxScores && typeof evaluation.MaxScores === "object") {
          maxScore = Object.values(evaluation.MaxScores).reduce(
            (sum, value) => sum + (Number(value) || 0),
            0,
          );
        } else if (!maxScore && evaluation.MaxScores !== undefined) {
          maxScore = evaluation.MaxScores;
        }

        return {
          id: String(evaluation.Id ?? ""),
          name: evaluation.Name ?? "",
          shortName: evaluation.ShortName ?? "",
          type: String(evaluation.Type ?? ""),
          evaluationType: evaluation.EvalType ?? null,
          formula: evaluation.Formula ?? null,
          canExclude: evaluation.IsCanDontConsider ?? null,
          percent: toStringOrEmpty(evaluation.Percent),
          maxScores: evaluation.MaxScores ?? null,
          score: toStringOrEmpty(evaluation.Score),
          maxScore: toStringOrEmpty(maxScore),
          description: "",
          disabled: null,
          comment: "",
          subEvals: [],
        };
      }),
    }));

    if (!skipDetails) await this.fetchAllSubjectDetails(parsedSubjects);
    return parsedSubjects;
  }

  async fetchSubjectDetails(subject) {
    for (const evaluation of subject.evaluations) {
      const result = (
        await this.postJson(
          "/Jce/Diary/GetResultByEvalution",
          { journalId: subject.journalId, evalId: evaluation.id },
          { retries: 1, timeoutMs: 10000 },
        )
      ).data;

      if (Array.isArray(result) && result.length) {
        let totalScore = 0;
        let totalMaxScore = 0;
        let hasScore = false;
        let hasMaxScore = false;
        const subEvals = [];
        for (const item of result) {
          if (!item || typeof item !== "object") continue;
          const score = toStringOrEmpty(item.Score).trim().replace(",", ".");
          const maximum = toStringOrEmpty(item.MaxScore).trim().replace(",", ".");
          if (score && Number.isFinite(Number(score))) {
            totalScore += Number(score);
            hasScore = true;
          }
          if (maximum && Number.isFinite(Number(maximum))) {
            totalMaxScore += Number(maximum);
            hasMaxScore = true;
          }
          subEvals.push({
            name: item.Name ?? "",
            score: toStringOrEmpty(item.Score),
            maxScore: toStringOrEmpty(item.MaxScore),
            description: toStringOrEmpty(item.Description),
            disabled: item.Disabled ?? null,
            comment: toStringOrEmpty(item.Comment),
          });
        }
        if (hasScore) evaluation.score = String(totalScore);
        if (hasMaxScore) evaluation.maxScore = String(totalMaxScore);
        evaluation.subEvals = subEvals;
      } else if (result && typeof result === "object") {
        if (result.Score !== undefined && result.Score !== null) {
          evaluation.score = String(result.Score);
        }
        if (result.MaxScore !== undefined && result.MaxScore !== null) {
          evaluation.maxScore = String(result.MaxScore);
        }
        evaluation.description = toStringOrEmpty(result.Description);
        evaluation.disabled = result.Disabled ?? null;
        evaluation.comment = toStringOrEmpty(result.Comment);
      }
    }
    return subject;
  }

  async fetchAllSubjectDetails(subjects, { onSubjectComplete } = {}) {
    let nextIndex = 0;
    let completed = 0;
    let failure;
    const worker = async () => {
      while (!failure && nextIndex < subjects.length) {
        const subject = subjects[nextIndex++];
        try {
          // Each evaluation request carries its journal and evaluation IDs.
          await this.fetchSubjectDetails(subject);
          onSubjectComplete?.({ completed: ++completed, total: subjects.length, subject });
        } catch (error) {
          failure ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, subjects.length) }, worker));
    if (failure) throw failure;
  }

  async getReportCard(schoolYearId, { studentLogin } = {}) {
    const roles = (
      await this.postJson("/ReportCard/GetRoles", undefined, {
        retries: 2,
        timeoutMs: 12000,
      })
    ).data;
    if (!Array.isArray(roles) || !roles.length) return [];

    const organizations = (
      await this.postJson("/ReportCard/GetOrganizations", undefined, {
        retries: 2,
        timeoutMs: 12000,
      })
    ).data;
    if (!Array.isArray(organizations) || !organizations.length) return [];

    const roleId = roles[0].Id;
    const organizationId = organizations[0].Id;
    const parallels = (
      await this.postJson(
        "/ReportCard/GetParallels",
        { organizationId, schoolYearId, roleId },
        { retries: 2, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(parallels) || !parallels.length) return [];

    const klasses = (
      await this.postJson(
        "/ReportCard/GetKlasses",
        { organizationId, schoolYearId, parallelId: parallels[0].Id, roleId },
        { retries: 2, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(klasses) || !klasses.length) return [];

    let selectedKlass = klasses[0];
    let selectedStudent;
    if (studentLogin) {
      for (const klass of klasses) {
        const students = (
          await this.postJson(
            "/ReportCard/GetStudents",
            { organizationId, schoolYearId, klassId: klass.Id, roleId },
            { retries: 1, timeoutMs: 12000 },
          )
        ).data;
        selectedStudent = Array.isArray(students)
          ? students.find((student) => this.matchStudent(student, studentLogin))
          : undefined;
        if (selectedStudent) {
          selectedKlass = klass;
          break;
        }
      }
    }

    if (!selectedStudent) {
      const students = (
        await this.postJson(
          "/ReportCard/GetStudents",
          { organizationId, schoolYearId, klassId: selectedKlass.Id, roleId },
          { retries: 2, timeoutMs: 12000 },
        )
      ).data;
      if (!Array.isArray(students) || !students.length) return [];
      selectedStudent = students[0];
    }

    const reportCardUrlData = (
      await this.postJson(
        "/ReportCard/GetUrl",
        {
          organizationId,
          schoolYearId,
          klassId: selectedKlass.Id,
          personId: selectedStudent.Id,
          isEditable: selectedStudent.IsEditable ?? false,
        },
        { retries: 2, timeoutMs: 14000 },
      )
    ).data;
    const reportCardUrl =
      typeof reportCardUrlData === "object" ? reportCardUrlData?.Url : reportCardUrlData;
    if (!reportCardUrl) return [];

    await this.request(reportCardUrl, { retries: 1, timeoutMs: 14000 });
    const rows = (
      await this.postJson("/ReportCardByStudent/GetData", undefined, {
        retries: 2,
        timeoutMs: 14000,
      })
    ).data;
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
      subjectName: row.SubjectName ?? "",
      componentName: row.ComponentName ?? "",
      evaluationSystemName: row.EvaluationSystemName ?? "",
      evaluationType: row.EvaluationType ?? null,
      componentType: row.ComponentType ?? null,
      exempt: row.IsExemptionFromSubject ?? null,
      notChosen: row.IsNotChosen ?? null,
      periods: [
        normalizeReportCardValue(row.FirstPeriod),
        normalizeReportCardValue(row.SecondPeriod),
        normalizeReportCardValue(row.ThirdPeriod),
        normalizeReportCardValue(row.ForthPeriod || row.FourthPeriod),
      ],
      halfYears: [
        normalizeReportCardValue(row.FirstHalfYear),
        normalizeReportCardValue(row.SecondHalfYear),
      ],
      year: normalizeReportCardValue(row.Year),
      exam: normalizeReportCardValue(row.Exam),
      final: normalizeReportCardValue(row.Final),
      reportedGrades: {
        q1: row.FirstPeriod ?? null,
        q2: row.SecondPeriod ?? null,
        q3: row.ThirdPeriod ?? null,
        q4: row.ForthPeriod ?? row.FourthPeriod ?? null,
        firstHalf: row.FirstHalfYear ?? null,
        secondHalf: row.SecondHalfYear ?? null,
        year: row.Year ?? null,
        exam: row.Exam ?? null,
        final: row.Final ?? null,
      },
    }));
  }
}
