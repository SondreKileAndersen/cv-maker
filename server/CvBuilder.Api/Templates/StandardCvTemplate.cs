using CvBuilder.Api.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CvBuilder.Api.Templates;

public sealed class StandardCvTemplate : ICvPdfTemplate
{
    public string Id => "cv-kiwi-standard";
    public string Name => "CV Kiwi standard";
    public string Description => "A4 CV-mal med mørkt toppbanner, seksjonsfaner og oransje aksentlinjer.";

    private const string Dark = "#212121";
    private const string Accent = "#FFAE3D";
    private const string Body = "#7A7A7A";
    private const string LightBody = "#D3D3D3";

    public byte[] Render(CvDocument document)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0);
                page.DefaultTextStyle(DefaultTextStyle);
                page.Content().Element(c => ComposeFirstPage(c, document));
            });

            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(0);
                page.DefaultTextStyle(DefaultTextStyle);
                page.Content().Element(c => ComposeSecondPage(c, document));
            });
        }).GeneratePdf();
    }

    private static TextStyle DefaultTextStyle(TextStyle style) => style
        .FontFamily("Calibri")
        .FontSize(10.98f)
        .FontColor(Body);

    private static void ComposeFirstPage(IContainer container, CvDocument document)
    {
        var work = document.Sections.FirstOrDefault(s => SectionMatch(s, "arbeid"));

        container.Column(column =>
        {
            column.Item().Height(132).Background(Dark).Element(c => ComposeHeader(c, document.Profile));
            column.Item().PaddingTop(24).Element(c => SectionTab(c, work?.Title ?? "Arbeidserfaring", 163));
            column.Item().PaddingTop(26).PaddingHorizontal(40).Element(c => EntryList(c, work?.Entries ?? []));
        });
    }

    private static void ComposeSecondPage(IContainer container, CvDocument document)
    {
        var education = document.Sections.FirstOrDefault(s => SectionMatch(s, "utdanning"));

        container.Column(column =>
        {
            column.Item().Element(c => SectionTab(c, education?.Title ?? "Utdanning", 132));
            column.Item().PaddingTop(24).PaddingHorizontal(40).Element(c => EntryList(c, education?.Entries ?? [], compact: true));

            column.Item().PaddingTop(34).Element(c => SectionTab(c, "Annet", 169));
            column.Item().PaddingTop(22).PaddingHorizontal(40).Element(c => SkillArea(c, document.SkillGroups));

            if (document.ReferencesEnabled)
            {
                column.Item().PaddingTop(34).Element(c => SectionTab(c, "Referanser", 132));
                column.Item().PaddingTop(22).PaddingHorizontal(40).Text("Referanser oppgis på forespørsel.").FontSize(10.98f).FontColor(Body);
            }
        });
    }

    private static void ComposeHeader(IContainer container, Profile profile)
    {
        container.PaddingHorizontal(40).Row(row =>
        {
            row.ConstantItem(125).AlignMiddle().Element(c => Photo(c, profile.PhotoDataUrl));

            row.RelativeItem().PaddingTop(25).Column(col =>
            {
                var nameParts = SplitName(profile.FullName);
                foreach (var part in nameParts)
                    col.Item().Text(part).FontSize(24).Bold().FontColor(Colors.White).LineHeight(1.08f);

                col.Item().PaddingTop(9).Text(profile.Title).FontSize(12).Bold().FontColor(LightBody);
                col.Item().PaddingTop(3).Text(profile.Organization).FontSize(10.98f).Bold().FontColor(LightBody);
            });

            row.ConstantItem(228).PaddingTop(21).Column(col =>
            {
                ContactRow(col, profile.BirthDate, "cal");
                ContactRow(col, profile.Address, "pin");
                ContactRow(col, profile.Phone, "tel");
                ContactRow(col, profile.Email, "mail");
                ContactRow(col, profile.SocialLabel, "net");
            });
        });
    }

    private static void ContactRow(ColumnDescriptor col, string? text, string marker)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;

        col.Item().PaddingBottom(6).Row(row =>
        {
            row.RelativeItem().AlignRight().Text(text).FontSize(9.2f).Bold().FontColor(LightBody);
            row.ConstantItem(22).AlignRight().Text(marker).FontSize(8.5f).Bold().FontColor(Accent);
        });
    }

    private static void Photo(IContainer container, string? photoDataUrl)
    {
        var imageBytes = DecodeDataUrl(photoDataUrl);

        container.Width(88).Height(88).Border(4).BorderColor(Accent).Padding(2).Element(c =>
        {
            if (imageBytes is { Length: > 0 })
                c.Image(imageBytes).FitArea();
            else
                c.Background("#E8E8E8").AlignCenter().AlignMiddle().Text("Bilde").FontSize(10).FontColor(Body);
        });
    }

    private static void SectionTab(IContainer container, string title, float width)
    {
        container.Width(width).Height(32).Background(Dark).PaddingLeft(40).AlignMiddle()
            .Text(title).FontSize(12).Bold().FontColor(Colors.White);
    }

    private static void EntryList(IContainer container, IReadOnlyList<CvEntry> entries, bool compact = false)
    {
        container.Column(col =>
        {
            foreach (var entry in entries)
            {
                col.Item().PaddingBottom(compact ? 27 : 32).Element(c => Entry(c, entry));
            }
        });
    }

    private static void Entry(IContainer container, CvEntry entry)
    {
        container.Column(col =>
        {
            col.Item().Element(c => UnderlinedTitle(c, entry.Title));

            if (!string.IsNullOrWhiteSpace(entry.Subtitle))
                col.Item().PaddingTop(5).Text(entry.Subtitle).FontSize(10.98f).Bold().FontColor(Body);

            foreach (var line in entry.Lines)
            {
                col.Item().PaddingTop(4).Text(text =>
                {
                    foreach (var run in line.Runs)
                    {
                        var span = text.Span(run.Text).FontSize(10.98f).FontColor(Body);
                        if (run.Bold)
                            span.Bold();
                    }
                });
            }
        });
    }

    private static void UnderlinedTitle(IContainer container, string title)
    {
        var width = Math.Clamp(title.Length * 5.3f, 38f, 510f);

        container.Width(width).BorderBottom(1).BorderColor(Accent).PaddingBottom(1)
            .Text(title).FontSize(12).Bold().FontColor(Colors.Black);
    }

    private static void SkillArea(IContainer container, IReadOnlyList<SkillGroup> groups)
    {
        var left = groups.Where(g => g.Column <= 1).ToList();
        var right = groups.Where(g => g.Column > 1).ToList();

        container.Row(row =>
        {
            row.RelativeItem().Column(col => SkillColumn(col, left));
            row.ConstantItem(36);
            row.RelativeItem().Column(col => SkillColumn(col, right));
        });
    }

    private static void SkillColumn(ColumnDescriptor col, IReadOnlyList<SkillGroup> groups)
    {
        foreach (var group in groups)
        {
            col.Item().PaddingBottom(26).Column(inner =>
            {
                inner.Item().Element(c => UnderlinedTitle(c, group.Title));
                inner.Item().PaddingTop(6).Text(group.Content).FontSize(10.98f).FontColor(Body);
            });
        }
    }

    private static void ReferenceList(IContainer container, IReadOnlyList<ReferencePerson> references)
    {
        container.Column(col =>
        {
            foreach (var reference in references)
            {
                col.Item().PaddingBottom(23).Column(inner =>
                {
                    inner.Item().Element(c => UnderlinedTitle(c, reference.NameAndRole));
                    inner.Item().PaddingTop(6).Text(reference.Organization).FontSize(10.98f).Bold().FontColor(Body);

                    if (!string.IsNullOrWhiteSpace(reference.Phone))
                        inner.Item().PaddingTop(4).Text(reference.Phone).FontSize(10.98f).FontColor(Body);

                    if (!string.IsNullOrWhiteSpace(reference.Email))
                        inner.Item().PaddingTop(4).Text(reference.Email).FontSize(10.98f).FontColor(Body);
                });
            }
        });
    }

    private static bool SectionMatch(CvSection section, string value) =>
        section.Title.Contains(value, StringComparison.OrdinalIgnoreCase) ||
        section.Id.Contains(value, StringComparison.OrdinalIgnoreCase);

    private static IReadOnlyList<string> SplitName(string fullName)
    {
        if (string.IsNullOrWhiteSpace(fullName))
            return ["Navn"];

        var parts = fullName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length <= 2)
            return [fullName.Trim()];

        return [parts[0], string.Join(' ', parts.Skip(1))];
    }

    private static byte[]? DecodeDataUrl(string? dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl))
            return null;

        var commaIndex = dataUrl.IndexOf(',', StringComparison.Ordinal);
        var base64 = commaIndex >= 0 ? dataUrl[(commaIndex + 1)..] : dataUrl;

        try
        {
            return Convert.FromBase64String(base64);
        }
        catch
        {
            return null;
        }
    }
}
