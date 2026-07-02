/** Native toast wrapper (DESIGN.md §13). Clicking a notification surfaces the companion and,
 *  when the toast concerns a task, deep-links it via the 'nav:focusTask' push (wired in index). */
import { Notification } from 'electron'

export interface AppNotificationPayload {
  title: string
  body: string
  taskId?: string
}

export interface NotifierDeps {
  onActivate: (taskId?: string) => void
}

export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  notify(n: AppNotificationPayload): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: n.title, body: n.body, silent: false })
    notification.on('click', () => this.deps.onActivate(n.taskId))
    notification.show()
  }
}
