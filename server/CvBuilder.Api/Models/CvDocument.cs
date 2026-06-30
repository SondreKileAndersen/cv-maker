namespace CvBuilder.Api.Models;

public sealed class CvDocument
{
    public string TemplateId { get; set; } = "cv-kiwi-standard";
    public Profile Profile { get; set; } = new();
    public List<CvSection> Sections { get; set; } = [];
    public List<SkillGroup> SkillGroups { get; set; } = [];
    public List<ReferencePerson> References { get; set; } = [];
    public bool ReferencesEnabled { get; set; }
    public List<GeneratedVersion> GeneratedVersions { get; set; } = [];
}

public sealed class Profile
{
    public string FullName { get; set; } = "";
    public string Title { get; set; } = "";
    public string Organization { get; set; } = "";
    public string BirthDate { get; set; } = "";
    public string Address { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string SocialLabel { get; set; } = "SoMe";
    public string SocialUrl { get; set; } = "";
    public string? PhotoDataUrl { get; set; }
}

public sealed class CvSection
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "";
    public List<CvEntry> Entries { get; set; } = [];
}

public sealed class CvEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public List<RichLine> Lines { get; set; } = [];
    public string? Url { get; set; }
}

public sealed class RichLine
{
    public List<RichTextRun> Runs { get; set; } = [];

    public static RichLine Plain(string text) => new()
    {
        Runs = [new RichTextRun { Text = text }]
    };
}

public sealed class RichTextRun
{
    public string Text { get; set; } = "";
    public bool Bold { get; set; }
}

public sealed class SkillGroup
{
    public string Title { get; set; } = "";
    public string Content { get; set; } = "";
    public int Column { get; set; } = 1;
}

public sealed class ReferencePerson
{
    public string NameAndRole { get; set; } = "";
    public string Organization { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
}

public sealed class GeneratedVersion
{
    public string FileName { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string TemplateId { get; set; } = "";
}
