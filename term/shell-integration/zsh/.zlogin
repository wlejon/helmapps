# term: the user's .zlogin from their real ZDOTDIR (see .zshenv), then
# ZDOTDIR handed back.
ZDOTDIR=$__bro_term_user_zdotdir
[[ -r $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
__bro_term_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__bro_term_zdotdir
__bro_term_handback
