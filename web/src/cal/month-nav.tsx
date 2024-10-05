import styles from "./cal.module.css";

const daysOfWeek = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, i + 2).toLocaleDateString(undefined, { weekday: "long" }),
);

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

export const MonthNav = () => {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentDay = currentDate.getDate();
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);

  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const daysArray = Array.from(
    { length: daysInMonth + firstDayOfMonth },
    (_, i) => (i < firstDayOfMonth ? null : i - firstDayOfMonth + 1),
  );

  const weeks = [];
  for (let i = 0; i < daysArray.length; i += 7) {
    weeks.push(daysArray.slice(i, i + 7));
  }

  return (
    <table className={styles["mini-cal"]}>
      <thead>
        <tr className={styles["weekday"]}>
          {daysOfWeek.map((day) => (
            <th key={day}>{day.slice(0, 2)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, weekIndex) => (
          <tr key={weekIndex} className={styles["day-index"]}>
            {week.map((day, dayIndex) => (
              <td
                key={dayIndex}
                className={day === currentDay ? styles["current-day"] : ""}
              >
                {day}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
